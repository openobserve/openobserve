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
//! `traces::service_graph::aggregator::write_sql_aggregated_edges`. The
//! record→JSON transform (`records_to_json`) is a pure helper that lives in the
//! enterprise crate; this OSS layer owns only the self-ingest I/O.

use config::meta::agent_signals::AgentSignalRecord;

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
    let record_count = records.len();
    let enriched = o2_enterprise::enterprise::agent_signals::records_to_json(&records);
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
    crate::ingestion::ingestion_service::ingest(req)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
        .inspect_err(|e| {
            log::error!("[AgentSignals] Failed to write agent signal records: {e}");
        })?;

    log::info!("[AgentSignals] Wrote {record_count} agent signal records for {org_id}");
    Ok(())
}

#[cfg(not(feature = "enterprise"))]
pub async fn write_agent_signals(
    _org_id: &str,
    _records: Vec<AgentSignalRecord>,
) -> Result<(), anyhow::Error> {
    Ok(())
}
