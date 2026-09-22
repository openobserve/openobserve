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
//! It lives beside the reporting queue rather than in `openobserve-core`, so the crates
//! that ingest outside the log path -- enrichment tables among them -- can report a scan
//! they could not run without depending on the whole ingest crate.

use config::{
    meta::{
        self_reporting::{
            ReportingData,
            redaction::{DataWindow, EvidenceScope, GapReason, RedactionEvidence},
        },
        stream::StreamType,
    },
    metrics,
    utils::json::{Map, Value},
};
use tokio::sync::mpsc::error::TrySendError;

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
    stream_type: StreamType,
    streams: I,
    posture: config::meta::self_reporting::redaction::FailPosture,
) where
    I: Iterator<Item = (&'a str, &'a [(i64, Map<String, Value>)])>,
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
}

fn enqueue_rows(scope: &EvidenceScope, rows: Vec<RedactionEvidence>) {
    for row in rows {
        count_regions(scope, &row);
        let reason = match super::try_enqueue(ReportingData::Redaction(Box::new(row))) {
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
    use config::meta::{
        self_reporting::redaction::{FailPosture, FieldOutcome},
        stream::StreamType,
    };

    use super::*;

    #[test]
    fn the_region_counter_ignores_rows_with_nothing_to_count() {
        let scope = EvidenceScope::new("metric-org", "metric-stream", StreamType::Logs);
        let marker = RedactionEvidence::scan_unavailable(
            &scope,
            FailPosture::Open,
            3,
            DataWindow::default(),
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

    #[test]
    fn a_queue_failure_counts_a_dropped_row() {
        let scope = EvidenceScope::new("drop-org", "drop-stream", StreamType::Logs);
        let before = metrics::SDR_EVIDENCE_DROPPED_TOTAL
            .with_label_values(&["drop-org", "queue_full"])
            .get();
        record_gap(&scope, GapReason::QueueFull, 2);
        assert_eq!(
            metrics::SDR_EVIDENCE_DROPPED_TOTAL
                .with_label_values(&["drop-org", "queue_full"])
                .get(),
            before + 2
        );
    }
}
