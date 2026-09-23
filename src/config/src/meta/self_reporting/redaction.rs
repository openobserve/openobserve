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

//! Ingestion-time evidence that the redaction engine ran, and what it replaced.

use std::{
    collections::HashMap,
    fmt,
    sync::{
        LazyLock as Lazy,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};

use super::usage::{
    AUDIT_STREAM, DATA_RETENTION_USAGE_STREAM, ERROR_STREAM, STATS_STREAM, TRIGGERS_STREAM,
    USAGE_STREAM,
};
use crate::{get_config, meta::stream::StreamType, utils::time::now_micros};

pub const REDACTION_EVIDENCE_STREAM: &str = "_redaction_evidence";

// V1 counts ingestion only; search counts would measure query access, not data.
pub const INGESTION_APPLY_TIME: &str = "ingestion";

// Per-(node, org) run of sequence numbers; a hole in it is how an auditor detects loss.
static SEQUENCE: Lazy<SequenceTracker> = Lazy::new(SequenceTracker::default);

// Restarts reset the sequence, so every row carries the run this number belongs to.
static NODE_START_TS: Lazy<i64> = Lazy::new(now_micros);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Redaction,
    IntervalMarker,
    Gap,
    ScanUnavailable,
}

impl fmt::Display for EvidenceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Redaction => "redaction",
            Self::IntervalMarker => "interval_marker",
            Self::Gap => "gap",
            Self::ScanUnavailable => "scan_unavailable",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GapReason {
    QueueFull,
    QueueClosed,
    PersistFailed,
    IngestionRejected,
}

impl fmt::Display for GapReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::QueueFull => "queue_full",
            Self::QueueClosed => "queue_closed",
            Self::PersistFailed => "persist_failed",
            Self::IngestionRejected => "ingestion_rejected",
        })
    }
}

/// Whether a scan failure let the write through unredacted, or refused it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailPosture {
    Open,
    Closed,
}

impl fmt::Display for FailPosture {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Open => "open",
            Self::Closed => "closed",
        })
    }
}

/// The (org, stream) a row is about, plus the pattern set in effect when it was emitted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EvidenceScope {
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: String,
    pub patterns_configured: u64,
    pub pattern_names: Vec<String>,
    pub pattern_rules: Vec<String>,
    pub pattern_hash: String,
    pub pattern_updated_at: Option<i64>,
}

impl EvidenceScope {
    pub fn new(org_id: &str, stream_name: &str, stream_type: StreamType) -> Self {
        Self {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            stream_type: stream_type.to_string(),
            ..Default::default()
        }
    }

    pub fn with_patterns(
        mut self,
        pattern_names: Vec<String>,
        pattern_bodies: &[String],
        pattern_updated_at: Option<i64>,
    ) -> Self {
        self.patterns_configured = pattern_names.len() as u64;
        // No policy to state, so the label carries the name alone rather than inventing one.
        self.pattern_rules = sorted_labels(pattern_names.iter().cloned());
        self.pattern_names = pattern_names;
        self.pattern_hash = pattern_set_hash(pattern_bodies);
        self.pattern_updated_at = pattern_updated_at;
        self
    }

    /// Carries each body's policy into the hash, so an audit can tell Redact from Detect.
    pub fn with_pattern_rules(
        mut self,
        rules: &[PatternRule],
        pattern_updated_at: Option<i64>,
    ) -> Self {
        self.patterns_configured = rules.len() as u64;
        self.pattern_names = rules.iter().map(|rule| rule.name.clone()).collect();
        self.pattern_rules = pattern_rule_labels(rules);
        self.pattern_hash = pattern_rule_set_hash(rules);
        self.pattern_updated_at = pattern_updated_at;
        self
    }
}

/// One configured pattern as evidence sees it: a name and policy to publish, a body only to hash.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PatternRule {
    pub name: String,
    pub body: String,
    pub policy: String,
}

/// What one field's scan produced in one batch. Regions and drops are never summed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FieldOutcome {
    pub redacted_regions: u64,
    /// Matched under `Detect` and deliberately left intact; never added to `redacted_regions`.
    pub detected_regions: u64,
    pub dropped_fields: u64,
    pub dropfield_shadowed: bool,
    pub records_scanned: u64,
    pub records_affected: u64,
    pub fields_scanned: u64,
}

/// The data's own time range, which is what an auditor's window filters on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DataWindow {
    pub min_ts: Option<i64>,
    pub max_ts: Option<i64>,
}

impl DataWindow {
    pub fn from_timestamps<I: IntoIterator<Item = i64>>(timestamps: I) -> Self {
        let mut window = Self::default();
        for ts in timestamps {
            window.min_ts = Some(window.min_ts.map_or(ts, |min| min.min(ts)));
            window.max_ts = Some(window.max_ts.map_or(ts, |max| max.max(ts)));
        }
        window
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RedactionEvidence {
    pub _timestamp: i64,
    pub kind: String,
    pub seq: u64,
    pub node_name: String,
    pub node_start_ts: i64,
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    pub apply_time: String,
    pub redacted_regions: u64,
    /// Content observed and left intact; a separate audit question from `redacted_regions`.
    pub detected_regions: u64,
    pub dropped_fields: u64,
    pub dropfield_shadowed: bool,
    pub records_scanned: u64,
    pub records_affected: u64,
    pub fields_scanned: u64,
    pub patterns_configured: u64,
    pub pattern_names: Vec<String>,
    /// `name:policy` per pattern, so a row says what the ruleset does without decoding the hash.
    pub pattern_rules: Vec<String>,
    pub pattern_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_min_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_max_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fail_posture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropped_rows: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_start_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_end_ts: Option<i64>,
}

impl RedactionEvidence {
    /// One field's replacements in one batch.
    pub fn redaction(
        scope: &EvidenceScope,
        field: &str,
        policy: &str,
        outcome: FieldOutcome,
        data: DataWindow,
    ) -> Self {
        let mut row = Self::base(EvidenceKind::Redaction, scope);
        row.field = Some(field.to_string());
        row.policy = Some(policy.to_string());
        row.redacted_regions = outcome.redacted_regions;
        row.detected_regions = outcome.detected_regions;
        row.dropped_fields = outcome.dropped_fields;
        row.dropfield_shadowed = outcome.dropfield_shadowed;
        row.records_scanned = outcome.records_scanned;
        row.records_affected = outcome.records_affected;
        row.fields_scanned = outcome.fields_scanned;
        row.data_min_ts = data.min_ts;
        row.data_max_ts = data.max_ts;
        row
    }

    /// Proof the engine was watching this stream over an interval, matches or not.
    pub fn interval_marker(
        scope: &EvidenceScope,
        outcome: FieldOutcome,
        data: DataWindow,
        window_start_ts: i64,
        window_end_ts: i64,
    ) -> Self {
        let mut row = Self::base(EvidenceKind::IntervalMarker, scope);
        row.redacted_regions = outcome.redacted_regions;
        row.detected_regions = outcome.detected_regions;
        row.dropped_fields = outcome.dropped_fields;
        row.records_scanned = outcome.records_scanned;
        row.records_affected = outcome.records_affected;
        row.fields_scanned = outcome.fields_scanned;
        row.data_min_ts = data.min_ts;
        row.data_max_ts = data.max_ts;
        row.window_start_ts = Some(window_start_ts);
        row.window_end_ts = Some(window_end_ts);
        row
    }

    /// Evidence that evidence was lost; it carries no counts of its own.
    pub fn gap(
        scope: &EvidenceScope,
        reason: GapReason,
        dropped_rows: u64,
        window_start_ts: i64,
        window_end_ts: i64,
    ) -> Self {
        let mut row = Self::base(EvidenceKind::Gap, scope);
        row.reason = Some(reason.to_string());
        row.dropped_rows = Some(dropped_rows);
        row.window_start_ts = Some(window_start_ts);
        row.window_end_ts = Some(window_end_ts);
        row
    }

    /// The window in which the pattern manager was down, and whether data still landed.
    pub fn scan_unavailable(
        scope: &EvidenceScope,
        posture: FailPosture,
        records_scanned: u64,
        data: DataWindow,
    ) -> Self {
        let mut row = Self::base(EvidenceKind::ScanUnavailable, scope);
        row.fail_posture = Some(posture.to_string());
        row.records_scanned = records_scanned;
        row.data_min_ts = data.min_ts;
        row.data_max_ts = data.max_ts;
        row
    }

    fn base(kind: EvidenceKind, scope: &EvidenceScope) -> Self {
        Self {
            _timestamp: now_micros(),
            kind: kind.to_string(),
            seq: SEQUENCE.next(&scope.org_id),
            node_name: get_config().common.instance_name.clone(),
            node_start_ts: *NODE_START_TS,
            org_id: scope.org_id.clone(),
            stream_name: scope.stream_name.clone(),
            stream_type: scope.stream_type.clone(),
            field: None,
            policy: None,
            apply_time: INGESTION_APPLY_TIME.to_string(),
            redacted_regions: 0,
            detected_regions: 0,
            dropped_fields: 0,
            dropfield_shadowed: false,
            records_scanned: 0,
            records_affected: 0,
            fields_scanned: 0,
            patterns_configured: scope.patterns_configured,
            pattern_names: scope.pattern_names.clone(),
            pattern_rules: scope.pattern_rules.clone(),
            pattern_hash: scope.pattern_hash.clone(),
            pattern_updated_at: scope.pattern_updated_at,
            data_min_ts: None,
            data_max_ts: None,
            fail_posture: None,
            reason: None,
            dropped_rows: None,
            window_start_ts: None,
            window_end_ts: None,
        }
    }

    /// A filled sample so schema inference sees every column, including the optional ones.
    pub fn init_for_reflection() -> Self {
        Self {
            _timestamp: 0,
            kind: EvidenceKind::Redaction.to_string(),
            seq: 0,
            node_name: String::new(),
            node_start_ts: 0,
            org_id: String::new(),
            stream_name: String::new(),
            stream_type: String::new(),
            field: Some(String::new()),
            policy: Some(String::new()),
            apply_time: INGESTION_APPLY_TIME.to_string(),
            redacted_regions: 0,
            detected_regions: 0,
            dropped_fields: 0,
            dropfield_shadowed: false,
            records_scanned: 0,
            records_affected: 0,
            fields_scanned: 0,
            patterns_configured: 0,
            pattern_names: vec![String::new()],
            pattern_rules: vec![String::new()],
            pattern_hash: String::new(),
            pattern_updated_at: Some(0),
            data_min_ts: Some(0),
            data_max_ts: Some(0),
            fail_posture: Some(FailPosture::Open.to_string()),
            reason: Some(GapReason::QueueFull.to_string()),
            dropped_rows: Some(0),
            window_start_ts: Some(0),
            window_end_ts: Some(0),
        }
    }

    pub fn schema_for_reflection() -> anyhow::Result<arrow_schema::Schema> {
        let sample = crate::utils::json::to_value(Self::init_for_reflection())?;
        // Match log ingestion by flattening before schema inference.
        let sample = crate::utils::flatten::flatten(sample)?;
        let sample = sample
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("Failed to convert RedactionEvidence to JSON object"))?;

        Ok(crate::utils::schema::infer_json_schema_from_map(
            REDACTION_EVIDENCE_STREAM,
            StreamType::Logs,
            std::iter::once(sample),
        )?)
    }
}

#[derive(Default)]
struct SequenceTracker {
    orgs: dashmap::DashMap<String, AtomicU64>,
}

impl SequenceTracker {
    fn next(&self, org_id: &str) -> u64 {
        self.orgs
            .entry(org_id.to_string())
            .or_default()
            .fetch_add(1, Ordering::Relaxed)
    }
}

/// Tracks when each (org, stream) last emitted a heartbeat, so the batch path drives it.
#[derive(Default)]
pub struct HeartbeatTracker {
    last: dashmap::DashMap<(String, String), i64>,
}

impl HeartbeatTracker {
    /// Returns the window a heartbeat must cover, or `None` while the interval is unexpired.
    pub fn due(
        &self,
        org_id: &str,
        stream_name: &str,
        now: i64,
        interval: i64,
    ) -> Option<(i64, i64)> {
        let key = (org_id.to_string(), stream_name.to_string());
        let mut entry = self.last.entry(key).or_insert(now);
        let previous = *entry;
        // A stream seen for the first time starts its interval now rather than emitting.
        if now - previous < interval {
            return None;
        }
        *entry = now;
        Some((previous, now))
    }
}

/// Coalesces drops per (org, stream, reason) so a sustained overflow is one row, not a flood.
#[derive(Default)]
pub struct GapAccumulator {
    pending: HashMap<(String, String, String), PendingGap>,
}

impl GapAccumulator {
    pub fn record(
        &mut self,
        scope: &EvidenceScope,
        reason: GapReason,
        dropped_rows: u64,
        now: i64,
    ) {
        let key = (
            scope.org_id.clone(),
            scope.stream_name.clone(),
            reason.to_string(),
        );
        let entry = self.pending.entry(key).or_insert_with(|| PendingGap {
            scope: scope.clone(),
            reason,
            dropped_rows: 0,
            window_start_ts: now,
            window_end_ts: now,
        });
        // The column is inferred Int64 from a `0` sample, so a u64 above i64::MAX cannot fit.
        entry.dropped_rows = entry
            .dropped_rows
            .saturating_add(dropped_rows)
            .min(i64::MAX as u64);
        entry.window_end_ts = now;
    }

    /// Drains every coalesced drop into one row per (org, stream, reason).
    pub fn drain(&mut self) -> Vec<RedactionEvidence> {
        self.pending
            .drain()
            .map(|(_, gap)| {
                RedactionEvidence::gap(
                    &gap.scope,
                    gap.reason,
                    gap.dropped_rows,
                    gap.window_start_ts,
                    gap.window_end_ts,
                )
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

struct PendingGap {
    scope: EvidenceScope,
    reason: GapReason,
    dropped_rows: u64,
    window_start_ts: i64,
    window_end_ts: i64,
}

/// True for streams the platform writes itself, whose scan evidence would feed the next scan.
pub fn is_self_reporting_stream(stream_name: &str) -> bool {
    matches!(
        stream_name,
        REDACTION_EVIDENCE_STREAM
            | USAGE_STREAM
            | AUDIT_STREAM
            | TRIGGERS_STREAM
            | ERROR_STREAM
            | STATS_STREAM
            | DATA_RETENTION_USAGE_STREAM
    )
}

/// Identity of the pattern set in effect, for callers that cannot yet supply per-pattern policies.
pub fn pattern_set_hash(pattern_bodies: &[String]) -> String {
    let rules: Vec<PatternRule> = pattern_bodies
        .iter()
        .map(|body| PatternRule {
            name: String::new(),
            body: body.clone(),
            policy: String::new(),
        })
        .collect();
    pattern_rule_set_hash(&rules)
}

/// The readable twin of `pattern_rule_set_hash`, over the same rules and never over a body.
pub fn pattern_rule_labels(rules: &[PatternRule]) -> Vec<String> {
    sorted_labels(
        rules
            .iter()
            .map(|rule| format!("{}:{}", rule.name, rule.policy)),
    )
}

/// What a body did, not just which body ran: the same regex under Redact and Detect differ.
pub fn pattern_rule_set_hash(rules: &[PatternRule]) -> String {
    // Name included: two rules can share a body, and a rename is a change an auditor can see.
    let mut digests: Vec<String> = rules
        .iter()
        .map(|rule| {
            sha256::digest(format!(
                "{}:{}:{}",
                rule.name,
                sha256::digest(&rule.body),
                rule.policy
            ))
        })
        .collect();
    digests.sort();
    digests.dedup();
    sha256::digest(digests.join(""))
}

fn sorted_labels<I: IntoIterator<Item = String>>(labels: I) -> Vec<String> {
    let mut labels: Vec<String> = labels.into_iter().collect();
    labels.sort();
    labels.dedup();
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(name: &str, body: &str, policy: &str) -> PatternRule {
        PatternRule {
            name: name.to_string(),
            body: body.to_string(),
            policy: policy.to_string(),
        }
    }

    #[test]
    fn evidence_kind_strings_are_the_documented_discriminators() {
        assert_eq!(EvidenceKind::Redaction.to_string(), "redaction");
        assert_eq!(EvidenceKind::IntervalMarker.to_string(), "interval_marker");
        assert_eq!(EvidenceKind::Gap.to_string(), "gap");
        assert_eq!(
            EvidenceKind::ScanUnavailable.to_string(),
            "scan_unavailable"
        );
    }

    #[test]
    fn gap_reason_strings_match_the_spec() {
        assert_eq!(GapReason::QueueFull.to_string(), "queue_full");
        assert_eq!(GapReason::QueueClosed.to_string(), "queue_closed");
        assert_eq!(GapReason::PersistFailed.to_string(), "persist_failed");
        assert_eq!(
            GapReason::IngestionRejected.to_string(),
            "ingestion_rejected"
        );
    }

    #[test]
    fn a_gap_row_carries_no_region_count() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let row = RedactionEvidence::gap(&scope, GapReason::QueueFull, 7, 10, 20);
        assert_eq!(row.kind, "gap");
        assert_eq!(row.redacted_regions, 0);
        assert_eq!(row.dropped_fields, 0);
        assert_eq!(row.field, None);
        assert_eq!(row.policy, None);
        assert_eq!(row.dropped_rows, Some(7));
        assert_eq!(row.reason.as_deref(), Some("queue_full"));
        assert_eq!(
            (row.window_start_ts, row.window_end_ts),
            (Some(10), Some(20))
        );
    }

    #[test]
    fn a_redaction_row_carries_the_field_and_data_window() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let outcome = FieldOutcome {
            redacted_regions: 3,
            records_scanned: 10,
            records_affected: 2,
            fields_scanned: 9,
            ..Default::default()
        };
        let row = RedactionEvidence::redaction(
            &scope,
            "message",
            "Redact",
            outcome,
            DataWindow::from_timestamps([50, 10, 30]),
        );
        assert_eq!(row.kind, "redaction");
        assert_eq!(row.field.as_deref(), Some("message"));
        assert_eq!(row.policy.as_deref(), Some("Redact"));
        assert_eq!(row.redacted_regions, 3);
        assert_eq!(row.apply_time, "ingestion");
        assert_eq!((row.data_min_ts, row.data_max_ts), (Some(10), Some(50)));
        assert_eq!(row.dropped_rows, None);
        assert_eq!(row.reason, None);
    }

    #[test]
    fn a_detect_row_counts_without_reporting_a_redaction() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let outcome = FieldOutcome {
            detected_regions: 4,
            records_scanned: 10,
            records_affected: 3,
            fields_scanned: 10,
            ..Default::default()
        };
        let row = RedactionEvidence::redaction(
            &scope,
            "message",
            "Detect",
            outcome,
            DataWindow::default(),
        );
        assert_eq!(row.detected_regions, 4);
        // Detect never mutates, so a row that detected 4 regions must still redact zero.
        assert_eq!(row.redacted_regions, 0);
        assert_eq!(row.policy.as_deref(), Some("Detect"));
    }

    #[test]
    fn detected_and_redacted_regions_are_carried_as_independent_counts() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let outcome = FieldOutcome {
            redacted_regions: 2,
            detected_regions: 5,
            ..Default::default()
        };
        let row = RedactionEvidence::redaction(
            &scope,
            "message",
            "Redact",
            outcome,
            DataWindow::default(),
        );
        assert_eq!(row.redacted_regions, 2);
        assert_eq!(row.detected_regions, 5);
        // Neither field may be a total of the other; 7 would mean the two were summed.
        assert_ne!(row.redacted_regions, 7);
        assert_ne!(row.detected_regions, 7);

        let marker =
            RedactionEvidence::interval_marker(&scope, outcome, DataWindow::default(), 100, 400);
        assert_eq!((marker.redacted_regions, marker.detected_regions), (2, 5));
    }

    #[test]
    fn rows_that_carry_no_counts_carry_no_detection_either() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let gap = RedactionEvidence::gap(&scope, GapReason::QueueFull, 7, 10, 20);
        assert_eq!(gap.detected_regions, 0);
        let unavailable = RedactionEvidence::scan_unavailable(
            &scope,
            FailPosture::Open,
            12,
            DataWindow::default(),
        );
        assert_eq!(unavailable.detected_regions, 0);
    }

    #[test]
    fn an_interval_marker_reports_a_scanned_zero() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs).with_patterns(
            vec!["card".to_string()],
            &["[0-9]{13,16}".to_string()],
            Some(99),
        );
        let outcome = FieldOutcome {
            records_scanned: 4_100_000,
            fields_scanned: 3,
            ..Default::default()
        };
        let row =
            RedactionEvidence::interval_marker(&scope, outcome, DataWindow::default(), 100, 400);
        assert_eq!(row.kind, "interval_marker");
        assert_eq!(row.redacted_regions, 0);
        assert_eq!(row.records_scanned, 4_100_000);
        assert_eq!(row.patterns_configured, 1);
        assert_eq!(row.pattern_names, vec!["card".to_string()]);
        assert_eq!(row.pattern_updated_at, Some(99));
        assert!(!row.pattern_hash.is_empty());
        assert_eq!(row.field, None);
    }

    #[test]
    fn scan_unavailable_records_whether_data_landed_unredacted() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let open = RedactionEvidence::scan_unavailable(
            &scope,
            FailPosture::Open,
            12,
            DataWindow::default(),
        );
        assert_eq!(open.kind, "scan_unavailable");
        assert_eq!(open.fail_posture.as_deref(), Some("open"));
        assert_eq!(open.records_scanned, 12);
        assert_eq!(open.redacted_regions, 0);

        let closed = RedactionEvidence::scan_unavailable(
            &scope,
            FailPosture::Closed,
            0,
            DataWindow::default(),
        );
        assert_eq!(closed.fail_posture.as_deref(), Some("closed"));
    }

    #[test]
    fn sequence_numbers_are_monotonic_and_isolated_per_org() {
        let tracker = SequenceTracker::default();
        assert_eq!(tracker.next("a"), 0);
        assert_eq!(tracker.next("a"), 1);
        assert_eq!(tracker.next("b"), 0);
        assert_eq!(tracker.next("a"), 2);
        assert_eq!(tracker.next("b"), 1);
    }

    #[test]
    fn heartbeat_is_due_only_after_the_interval_elapses() {
        let tracker = HeartbeatTracker::default();
        assert_eq!(tracker.due("org", "logs", 1_000, 300), None);
        assert_eq!(tracker.due("org", "logs", 1_200, 300), None);
        assert_eq!(tracker.due("org", "logs", 1_300, 300), Some((1_000, 1_300)));
        assert_eq!(tracker.due("org", "logs", 1_400, 300), None);
        assert_eq!(tracker.due("org", "other", 1_400, 300), None);
    }

    #[test]
    fn gap_rows_coalesce_per_org_stream_and_reason() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let other = EvidenceScope::new("org", "traces", StreamType::Logs);
        let mut acc = GapAccumulator::default();
        assert!(acc.is_empty());
        acc.record(&scope, GapReason::QueueFull, 2, 100);
        acc.record(&scope, GapReason::QueueFull, 3, 200);
        acc.record(&scope, GapReason::QueueClosed, 1, 150);
        acc.record(&other, GapReason::QueueFull, 4, 120);

        let mut rows = acc.drain();
        rows.sort_by(|a, b| {
            (a.stream_name.as_str(), a.reason.clone())
                .cmp(&(b.stream_name.as_str(), b.reason.clone()))
        });
        assert_eq!(rows.len(), 3);
        assert!(acc.is_empty());

        let full = rows
            .iter()
            .find(|r| r.stream_name == "logs" && r.reason.as_deref() == Some("queue_full"))
            .unwrap();
        assert_eq!(full.dropped_rows, Some(5));
        assert_eq!(
            (full.window_start_ts, full.window_end_ts),
            (Some(100), Some(200))
        );
    }

    #[test]
    fn gap_counts_saturate_at_what_an_int64_column_holds() {
        let scope = EvidenceScope::new("org", "logs", StreamType::Logs);
        let mut acc = GapAccumulator::default();
        acc.record(&scope, GapReason::QueueFull, u64::MAX, 1);
        acc.record(&scope, GapReason::QueueFull, 5, 2);
        assert_eq!(acc.drain()[0].dropped_rows, Some(i64::MAX as u64));
    }

    #[test]
    fn pattern_set_hash_is_order_independent_and_edit_sensitive() {
        let a = pattern_set_hash(&["aaa".to_string(), "bbb".to_string()]);
        let b = pattern_set_hash(&["bbb".to_string(), "aaa".to_string()]);
        assert_eq!(a, b);
        let edited = pattern_set_hash(&["aaa".to_string(), "bbc".to_string()]);
        assert_ne!(a, edited);
        assert_eq!(a.len(), 64);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase())
        );
    }

    #[test]
    fn pattern_set_hash_never_contains_the_regex_body() {
        let body = "[0-9]{13,16}".to_string();
        assert!(!pattern_set_hash(std::slice::from_ref(&body)).contains("0-9"));
        let rules = [rule("card", "[0-9]{13,16}", "Redact")];
        assert!(!pattern_rule_set_hash(&rules).contains("0-9"));
    }

    #[test]
    fn the_same_body_under_redact_and_detect_hash_differently() {
        let redact = pattern_rule_set_hash(&[rule("card", "[0-9]{13,16}", "Redact")]);
        let detect = pattern_rule_set_hash(&[rule("card", "[0-9]{13,16}", "Detect")]);
        let drop_field = pattern_rule_set_hash(&[rule("card", "[0-9]{13,16}", "DropField")]);
        assert_ne!(redact, detect);
        assert_ne!(redact, drop_field);
        assert_ne!(detect, drop_field);
    }

    #[test]
    fn two_rules_sharing_a_body_are_not_one_rule() {
        let one = pattern_rule_set_hash(&[rule("card", "[0-9]{16}", "Redact")]);
        let two = pattern_rule_set_hash(&[
            rule("card", "[0-9]{16}", "Redact"),
            rule("account", "[0-9]{16}", "Redact"),
        ]);
        assert_ne!(one, two);
    }

    #[test]
    fn renaming_a_rule_moves_the_hash_with_the_labels() {
        let before = [rule("card", "[0-9]{16}", "Redact")];
        let after = [rule("pan", "[0-9]{16}", "Redact")];
        assert_ne!(
            pattern_rule_set_hash(&before),
            pattern_rule_set_hash(&after)
        );
        assert_ne!(pattern_rule_labels(&before), pattern_rule_labels(&after));
    }

    #[test]
    fn a_rule_set_hash_is_order_independent_and_deduped() {
        let a = rule("ra", "aaa", "Redact");
        let b = rule("rb", "bbb", "Detect");
        assert_eq!(
            pattern_rule_set_hash(&[a.clone(), b.clone()]),
            pattern_rule_set_hash(&[b, a.clone()])
        );
        // A duplicated rule is the same ruleset, so it must not change the identity.
        assert_eq!(
            pattern_rule_set_hash(std::slice::from_ref(&a)),
            pattern_rule_set_hash(&[a.clone(), a])
        );
    }

    #[test]
    fn a_repeated_body_does_not_change_the_pattern_set_hash() {
        let one = pattern_set_hash(&["aaa".to_string()]);
        let twice = pattern_set_hash(&["aaa".to_string(), "aaa".to_string()]);
        assert_eq!(one, twice);
    }

    #[test]
    fn with_pattern_rules_separates_a_redact_scope_from_a_detect_one() {
        let scope = || EvidenceScope::new("org", "logs", StreamType::Logs);
        let redact = scope().with_pattern_rules(&[rule("card", "[0-9]{16}", "Redact")], None);
        let detect = scope().with_pattern_rules(&[rule("card", "[0-9]{16}", "Detect")], None);
        assert_ne!(redact.pattern_hash, detect.pattern_hash);
        assert_eq!(redact.patterns_configured, 1);
        assert_eq!(redact.pattern_names, vec!["card".to_string()]);
        assert_eq!(redact.pattern_rules, vec!["card:Redact".to_string()]);
        assert_eq!(detect.pattern_rules, vec!["card:Detect".to_string()]);
    }

    #[test]
    fn pattern_rules_are_sorted_and_never_carry_a_regex_body() {
        let rules = [
            rule("ssn", "[0-9]{3}-[0-9]{2}-[0-9]{4}", "Detect"),
            rule("card", "[0-9]{13,16}", "Redact"),
        ];
        let labels = pattern_rule_labels(&rules);
        assert_eq!(
            labels,
            vec!["card:Redact".to_string(), "ssn:Detect".to_string()]
        );
        // Bodies are sensitive in their own right, so no label may leak one.
        for label in &labels {
            assert!(!label.contains("0-9"), "{label} leaked a regex body");
            assert!(!label.contains('{'), "{label} leaked a regex body");
        }
        let scope =
            EvidenceScope::new("org", "logs", StreamType::Logs).with_pattern_rules(&rules, Some(7));
        assert_eq!(scope.pattern_rules, labels);
        assert!(!scope.pattern_rules.iter().any(|l| l.contains("0-9")));
    }

    #[test]
    fn pattern_rules_cover_the_same_set_the_hash_covers() {
        let rules = [
            rule("card", "[0-9]{16}", "Redact"),
            rule("card", "[0-9]{16}", "Detect"),
        ];
        let scope =
            EvidenceScope::new("org", "logs", StreamType::Logs).with_pattern_rules(&rules, None);
        // One name under two policies is two rules, and the labels must say so as the hash does.
        assert_eq!(
            scope.pattern_rules,
            vec!["card:Detect".to_string(), "card:Redact".to_string()]
        );
        let flipped = EvidenceScope::new("org", "logs", StreamType::Logs)
            .with_pattern_rules(&[rule("card", "[0-9]{16}", "Detect")], None);
        assert_ne!(scope.pattern_hash, flipped.pattern_hash);
        assert_ne!(scope.pattern_rules, flipped.pattern_rules);
    }

    #[test]
    fn data_window_of_no_records_is_empty() {
        let window = DataWindow::from_timestamps([]);
        assert_eq!(window.min_ts, None);
        assert_eq!(window.max_ts, None);
    }

    #[test]
    fn reflection_sample_exposes_every_column() {
        let sample = RedactionEvidence::init_for_reflection();
        let value = crate::utils::json::to_value(&sample).unwrap();
        let obj = value.as_object().unwrap();
        for key in [
            "_timestamp",
            "kind",
            "seq",
            "node_name",
            "node_start_ts",
            "org_id",
            "stream_name",
            "stream_type",
            "field",
            "policy",
            "apply_time",
            "redacted_regions",
            "detected_regions",
            "dropped_fields",
            "dropfield_shadowed",
            "records_scanned",
            "records_affected",
            "fields_scanned",
            "patterns_configured",
            "pattern_names",
            "pattern_rules",
            "pattern_hash",
            "pattern_updated_at",
            "data_min_ts",
            "data_max_ts",
            "fail_posture",
            "reason",
            "dropped_rows",
            "window_start_ts",
            "window_end_ts",
        ] {
            assert!(obj.contains_key(key), "missing {key}");
        }
        // The regex body is sensitive in its own right and must never be a column.
        assert!(!obj.contains_key("pattern"));
        assert!(!obj.contains_key("pattern_body"));
        assert!(!obj.contains_key("match_count"));
    }

    #[test]
    fn reflection_schema_covers_the_optional_columns() {
        let schema = RedactionEvidence::schema_for_reflection().unwrap();
        for field in [
            "field",
            "policy",
            "detected_regions",
            "pattern_names",
            "pattern_rules",
            "pattern_hash",
            "data_min_ts",
            "data_max_ts",
            "fail_posture",
            "reason",
            "dropped_rows",
            "window_start_ts",
            "window_end_ts",
        ] {
            assert!(schema.field_with_name(field).is_ok(), "missing {field}");
        }
    }

    #[test]
    fn the_counter_columns_are_inferred_as_int64() {
        let schema = RedactionEvidence::schema_for_reflection().unwrap();
        for field in [
            "redacted_regions",
            "detected_regions",
            "dropped_fields",
            "records_scanned",
            "records_affected",
            "fields_scanned",
            "dropped_rows",
            "patterns_configured",
        ] {
            assert_eq!(
                schema.field_with_name(field).unwrap().data_type(),
                &arrow_schema::DataType::Int64,
                "{field} is not Int64"
            );
        }
    }

    #[test]
    fn pattern_rules_is_the_same_queryable_shape_as_pattern_names() {
        let schema = RedactionEvidence::schema_for_reflection().unwrap();
        let names = schema.field_with_name("pattern_names").unwrap();
        let rules = schema.field_with_name("pattern_rules").unwrap();
        assert_eq!(rules.data_type(), names.data_type());
        assert_eq!(rules.data_type(), &arrow_schema::DataType::Utf8);
    }
}
