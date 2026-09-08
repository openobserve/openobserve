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

//! Raman digest sink.
//!
//! Self-ingests already-shaped digest records into the per-org
//! `_o2_raman_digests` stream, mirroring
//! `traces::agent_signals::aggregator::write_agent_signals`. Record shaping is
//! `raman_digest_records` in the scheduler handler — ungated, so a test can run
//! it. This file holds no branch on purpose:
//! `alerts::raman` is enterprise-gated, so everything here is compiled by
//! enterprise CI but exercised by no test suite in either edition.

use config::meta::stream::StreamType;
use proto::cluster_rpc;

/// The `_o2_` prefix is load-bearing: `is_internal_rollup_stream` is a prefix guard.
const DIGEST_STREAM: &str = "_o2_raman_digests";

/// Write already-shaped digest records to the org's `_o2_raman_digests` stream.
pub async fn write_digest_records(
    org_id: &str,
    records: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    let record_count = records.len();
    let req = cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        // `logs::ingest` forces Logs regardless; the search adapter reads Logs.
        stream_type: StreamType::Logs.as_str().to_string(),
        stream_name: DIGEST_STREAM.to_string(),
        data: Some(cluster_rpc::IngestionData {
            data: serde_json::to_vec(&records)?,
        }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        metadata: None,
    };
    crate::ingestion::ingestion_service::ingest(req)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
        .inspect_err(|e| {
            log::error!("[Raman] failed to write {record_count} digest records for {org_id}: {e}");
        })
}
