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

/// Write SQL-aggregated edge records directly to stream
/// Used when SQL query already performed aggregation
#[cfg(feature = "enterprise")]
pub async fn write_sql_aggregated_edges(
    org_id: &str,
    stream_name: &str,
    aggregated_records: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    if aggregated_records.is_empty() {
        return Ok(());
    }

    log::info!(
        "[ServiceGraph] Writing {} SQL-aggregated edges for {}/{}",
        aggregated_records.len(),
        org_id,
        stream_name
    );

    // Build bulk request body
    let mut bulk_body = String::new();
    let record_count = aggregated_records.len();

    for record in aggregated_records {
        // Transform SQL result to match expected schema
        let enriched_record = if let Some(obj) = record.as_object() {
            // Map SQL field names to storage schema using json! macro
            // Use 'end' timestamp so edges are recent and queryable by API
            config::utils::json::json!({
                "_timestamp": obj.get("end").cloned().unwrap_or(serde_json::json!(0)),
                "org_id": org_id,
                "trace_stream_name": stream_name,
                "client_service": obj.get("client").cloned().unwrap_or(serde_json::json!("")),
                "server_service": obj.get("server").cloned().unwrap_or(serde_json::json!("")),
                "connection_type": obj.get("connection_type").cloned().unwrap_or(serde_json::json!("standard")),
                "total_requests": obj.get("total_requests").cloned().unwrap_or(serde_json::json!(0)),
                "failed_requests": obj.get("errors").cloned().unwrap_or(serde_json::json!(0)),
                "error_rate": obj.get("error_rate").cloned().unwrap_or(serde_json::json!(0.0)),
                "p50_latency_ns": obj.get("p50").cloned().unwrap_or(serde_json::json!(0)),
                "p95_latency_ns": obj.get("p95").cloned().unwrap_or(serde_json::json!(0)),
                "p99_latency_ns": obj.get("p99").cloned().unwrap_or(serde_json::json!(0)),
            })
        } else {
            record
        };

        // Add bulk action line
        let action = config::utils::json::json!({"index": {"_index": "_o2_service_graph"}});
        bulk_body.push_str(&serde_json::to_string(&action)?);
        bulk_body.push('\n');

        // Add data line
        bulk_body.push_str(&serde_json::to_string(&enriched_record)?);
        bulk_body.push('\n');
    }

    // Write to stream
    if !bulk_body.is_empty() {
        use crate::common::meta::ingestion::{IngestUser, SystemJobType};

        let data = bytes::Bytes::from(bulk_body.into_bytes());

        crate::service::logs::bulk::ingest(
            0,
            org_id,
            data,
            IngestUser::SystemJob(SystemJobType::ServiceGraph),
        )
        .await
        .inspect_err(|e| {
            log::error!("[ServiceGraph] Failed to write SQL-aggregated edges: {e}");
        })?;
    }

    log::info!(
        "[ServiceGraph] Wrote {} SQL-aggregated edge summaries for {}",
        record_count,
        org_id
    );
    Ok(())
}

// Stub functions for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
pub fn aggregate_edges(_edges: Vec<()>) -> Result<(), anyhow::Error> {
    Ok(())
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
