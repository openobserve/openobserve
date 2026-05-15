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

//! Service Graph Aggregator
//!
//! Aggregates raw edges into minute-bucketed summaries for stream storage.
//! Used by the service graph daemon (not inline with trace ingestion).

/// Write SQL-aggregated edge records to the _o2_service_graph stream.
///
/// Forwards to an ingester via gRPC using the internal token — no root
/// credentials required. Works in all deployment topologies:
/// - Single-node: the local node registers itself in the NODES cache on startup (even in local
///   mode), so the gRPC lookup finds it and the call loops back to the same process.
/// - Distributed / cloud: routes to a separate ingester node.
#[cfg(feature = "enterprise")]
pub async fn write_sql_aggregated_edges(
    org_id: &str,
    stream_name: &str,
    aggregated_records: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    if aggregated_records.is_empty() {
        return Ok(());
    }

    let record_count = aggregated_records.len();
    log::info!(
        "[ServiceGraph] Writing {} SQL-aggregated edges for {}/{}",
        record_count,
        org_id,
        stream_name
    );

    // Transform SQL results to storage schema and collect as a JSON array.
    let enriched: Vec<serde_json::Value> = aggregated_records
        .into_iter()
        .filter_map(|v| match v {
            serde_json::Value::Object(o) => Some(o),
            _ => None,
        })
        .map(|mut obj| {
            config::utils::json::json!({
                "_timestamp": obj.remove("end").unwrap_or(serde_json::json!(0)),
                "org_id": org_id,
                "trace_stream_name": stream_name,
                "client_service": obj.remove("client").unwrap_or(serde_json::json!(null)),
                "server_service": obj.remove("server").unwrap_or(serde_json::json!("")),
                "total_requests": obj.remove("total_requests").unwrap_or(serde_json::json!(0)),
                "failed_requests": obj.remove("errors").unwrap_or(serde_json::json!(0)),
                "error_rate": obj.remove("error_rate").unwrap_or(serde_json::json!(0.0)),
                "p50_latency_ns": obj.remove("p50").unwrap_or(serde_json::json!(0)),
                "p95_latency_ns": obj.remove("p95").unwrap_or(serde_json::json!(0)),
                "p99_latency_ns": obj.remove("p99").unwrap_or(serde_json::json!(0)),
            })
        })
        .collect();

    use proto::cluster_rpc;
    let req = cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        stream_type: config::meta::stream::StreamType::ServiceGraph
            .as_str()
            .to_string(),
        stream_name: "_o2_service_graph".to_string(),
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
        .inspect_err(|e| {
            log::error!("[ServiceGraph] Failed to write SQL-aggregated edges: {e}");
        })?;

    log::info!("[ServiceGraph] Wrote {record_count} SQL-aggregated edge summaries for {org_id}");
    Ok(())
}

// Stub functions for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
pub fn aggregate_edges(_edges: Vec<()>) -> Result<(), anyhow::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "enterprise"))]
    use super::*;

    #[test]
    #[cfg(not(feature = "enterprise"))]
    fn test_aggregate_edges_empty_returns_ok() {
        assert!(aggregate_edges(vec![]).is_ok());
    }

    #[test]
    #[cfg(not(feature = "enterprise"))]
    fn test_aggregate_edges_nonempty_returns_ok() {
        assert!(aggregate_edges(vec![(), ()]).is_ok());
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn write_aggregated_edges(_org_id: &str, _aggregated: ()) -> Result<(), anyhow::Error> {
    Ok(())
}

#[cfg(not(feature = "enterprise"))]
pub async fn write_sql_aggregated_edges(
    _org_id: &str,
    _stream_name: &str,
    _records: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    Ok(())
}
