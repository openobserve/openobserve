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

//! Agent Signals Aggregator
//!
//! Self-ingests `AgentSignalRecord`s into the `_agent_signals` stream via the
//! existing `IngestionRequest` gRPC path, mirroring
//! `traces::service_graph::aggregator::write_sql_aggregated_edges`.

use config::meta::agent_signals::AgentSignalRecord;

/// Convert records to ingestable JSON (mirrors the shape write_sql_aggregated_edges produces).
/// Only used by the enterprise writer + its test; gated to keep the OSS build warning-free.
#[cfg(feature = "enterprise")]
pub(super) fn records_to_json(records: &[AgentSignalRecord]) -> Vec<serde_json::Value> {
    records.iter().map(|r| r.to_json()).collect()
}

/// Write agent-signal records to the `_agent_signals` stream.
///
/// Forwards to an ingester via gRPC using the internal token — no root
/// credentials required. Mirrors
/// `service_graph::aggregator::write_sql_aggregated_edges`.
#[cfg(feature = "enterprise")]
pub async fn write_agent_signals(
    org_id: &str,
    records: Vec<AgentSignalRecord>,
) -> Result<(), anyhow::Error> {
    use proto::cluster_rpc;

    if records.is_empty() {
        return Ok(());
    }
    let enriched = records_to_json(&records);
    let req = cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        // Reuse ServiceGraph stream_type; the stream *name* separates the data.
        stream_type: config::meta::stream::StreamType::ServiceGraph
            .as_str()
            .to_string(),
        stream_name: "_agent_signals".to_string(),
        data: Some(cluster_rpc::IngestionData {
            data: serde_json::to_vec(&enriched)?,
        }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        metadata: None,
    };
    crate::service::ingestion::ingestion_service::ingest(req)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
}

#[cfg(not(feature = "enterprise"))]
pub async fn write_agent_signals(
    _org_id: &str,
    _records: Vec<AgentSignalRecord>,
) -> Result<(), anyhow::Error> {
    Ok(())
}

#[cfg(all(test, feature = "enterprise"))]
mod test {
    use config::meta::agent_signals::AgentSignalRecord;

    #[test]
    fn test_records_serialize_to_ingestable_json() {
        let rec = AgentSignalRecord {
            timestamp: 42,
            org_id: "default".into(),
            source_stream: "s".into(),
            signal_type: "loop".into(),
            agent_name: Some("a".into()),
            tool_name: Some("t".into()),
            fail_class: None,
            count: 5,
            calls: Some(5),
            distinct_traces: Some(1),
            cost: None,
            tokens: None,
            errors: None,
            p95_latency_ns: None,
        };
        let payload = super::records_to_json(&[rec]);
        assert_eq!(payload.len(), 1);
        assert_eq!(payload[0]["_timestamp"], 42_i64);
        assert_eq!(payload[0]["signal_type"], "loop");
        assert!(payload[0].get("fail_class").is_none());
    }
}
