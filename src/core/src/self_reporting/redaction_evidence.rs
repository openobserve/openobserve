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

//! The async entry point every SDR call site hands its evidence rows to.
//!
//! The enqueue happens here, never on a rayon worker: the reporting queue is a
//! `Lazy` whose initializer calls `tokio::spawn`, which panics off-runtime.

use std::sync::{LazyLock as Lazy, Mutex};

use config::{
    get_config,
    meta::self_reporting::{
        ReportingData,
        redaction::{
            DataWindow, EvidenceScope, FieldOutcome, GapAccumulator, GapReason, HeartbeatTracker,
            RedactionEvidence,
        },
    },
    metrics,
    utils::time::now_micros,
};
use tokio::sync::mpsc::error::TrySendError;

// Emitting a heartbeat off a timer would claim coverage for streams that stopped
// sending data, so the batch path drives it instead.
static HEARTBEATS: Lazy<HeartbeatTracker> = Lazy::new(HeartbeatTracker::default);

// A dropped row is itself best-effort; coalescing keeps a sustained overflow from
// producing a flood of gap rows that guarantees its own loss.
static PENDING_GAPS: Lazy<Mutex<GapAccumulator>> =
    Lazy::new(|| Mutex::new(GapAccumulator::default()));

/// Enqueue the rows one batch produced, plus any heartbeat and retried gap rows.
pub async fn publish(scope: &EvidenceScope, rows: Vec<RedactionEvidence>, batch: BatchTotals) {
    let mut rows = rows;
    if let Some(heartbeat) = heartbeat_row(scope, &batch) {
        rows.push(heartbeat);
    }
    rows.extend(drain_pending_gaps());
    enqueue_rows(scope, rows);
}

/// Record that the pattern manager was unavailable, so a zero is not read as "clean".
pub async fn publish_scan_unavailable(
    scope: &EvidenceScope,
    posture: config::meta::self_reporting::redaction::FailPosture,
    records_scanned: u64,
    data: DataWindow,
) {
    let row = RedactionEvidence::scan_unavailable(scope, posture, records_scanned, data);
    enqueue_rows(scope, vec![row]);
}

/// One `scan_unavailable` row per stream in a batch the pattern manager could not scan.
pub async fn publish_scan_unavailable_for_streams<'a, I>(
    org_id: &str,
    stream_type: config::meta::stream::StreamType,
    streams: I,
    posture: config::meta::self_reporting::redaction::FailPosture,
) where
    I: Iterator<
        Item = (
            &'a str,
            &'a [(
                i64,
                config::utils::json::Map<String, config::utils::json::Value>,
            )],
        ),
    >,
{
    for (stream_name, records) in streams {
        let scope = EvidenceScope::new(org_id, stream_name, stream_type);
        let data = DataWindow::from_timestamps(records.iter().map(|(ts, _)| *ts));
        publish_scan_unavailable(&scope, posture, records.len() as u64, data).await;
    }
}

/// Records a loss that happened outside the enqueue path, such as a failed persist.
pub fn record_gap(scope: &EvidenceScope, reason: GapReason, dropped_rows: u64) {
    metrics::SDR_EVIDENCE_DROPPED_TOTAL
        .with_label_values(&[&scope.org_id, &reason.to_string()])
        .inc_by(dropped_rows);
    let Ok(mut pending) = PENDING_GAPS.lock() else {
        log::error!("[SDR-EVIDENCE] gap accumulator poisoned; {dropped_rows} rows unrecorded");
        return;
    };
    pending.record(scope, reason, dropped_rows, now_micros());
}

/// Per-batch totals for one (org, stream), used to fill a heartbeat row.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BatchTotals {
    pub outcome: FieldOutcome,
    pub data: DataWindow,
}

fn heartbeat_row(scope: &EvidenceScope, batch: &BatchTotals) -> Option<RedactionEvidence> {
    let interval = get_config().common.sdr_evidence_heartbeat_interval as i64 * 1_000_000;
    let (start, end) = HEARTBEATS.due(&scope.org_id, &scope.stream_name, now_micros(), interval)?;
    Some(RedactionEvidence::interval_marker(
        scope,
        batch.outcome,
        batch.data,
        start,
        end,
    ))
}

fn drain_pending_gaps() -> Vec<RedactionEvidence> {
    let Ok(mut pending) = PENDING_GAPS.lock() else {
        return Vec::new();
    };
    if pending.is_empty() {
        return Vec::new();
    }
    pending.drain()
}

fn enqueue_rows(scope: &EvidenceScope, rows: Vec<RedactionEvidence>) {
    for row in rows {
        count_regions(scope, &row);
        let reason = match usage_reporting::try_enqueue(ReportingData::Redaction(Box::new(row))) {
            Ok(()) => continue,
            Err(TrySendError::Full(_)) => GapReason::QueueFull,
            Err(TrySendError::Closed(_)) => GapReason::QueueClosed,
        };
        record_gap(scope, reason, 1);
    }
}

fn count_regions(scope: &EvidenceScope, row: &RedactionEvidence) {
    if row.redacted_regions == 0 {
        return;
    }
    let policy = row.policy.as_deref().unwrap_or("Redact");
    metrics::SDR_REDACTED_REGIONS_TOTAL
        .with_label_values(&[&scope.org_id, &scope.stream_type, policy])
        .inc_by(row.redacted_regions);
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;

    #[test]
    fn a_gap_is_coalesced_until_it_is_drained() {
        let scope = EvidenceScope::new("gap-org", "gap-stream", StreamType::Logs);
        record_gap(&scope, GapReason::PersistFailed, 3);
        record_gap(&scope, GapReason::PersistFailed, 4);

        let rows: Vec<_> = drain_pending_gaps()
            .into_iter()
            .filter(|row| row.org_id == "gap-org")
            .collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].dropped_rows, Some(7));
        assert_eq!(rows[0].reason.as_deref(), Some("persist_failed"));
        assert_eq!(rows[0].kind, "gap");
    }

    #[test]
    fn the_region_counter_ignores_rows_with_nothing_to_count() {
        let scope = EvidenceScope::new("metric-org", "metric-stream", StreamType::Logs);
        let marker = RedactionEvidence::interval_marker(
            &scope,
            FieldOutcome::default(),
            DataWindow::default(),
            0,
            1,
        );
        let before = metrics::SDR_REDACTED_REGIONS_TOTAL
            .with_label_values(&["metric-org", "logs", "Redact"])
            .get();
        count_regions(&scope, &marker);
        assert_eq!(
            metrics::SDR_REDACTED_REGIONS_TOTAL
                .with_label_values(&["metric-org", "logs", "Redact"])
                .get(),
            before
        );

        let redaction = RedactionEvidence::redaction(
            &scope,
            "message",
            "Hash",
            FieldOutcome {
                redacted_regions: 5,
                ..Default::default()
            },
            DataWindow::default(),
        );
        count_regions(&scope, &redaction);
        assert_eq!(
            metrics::SDR_REDACTED_REGIONS_TOTAL
                .with_label_values(&["metric-org", "logs", "Hash"])
                .get(),
            5
        );
    }
}
