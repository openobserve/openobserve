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

//! Writes digest records to the org's `_o2_alert_calibration_digests` stream.

use config::meta::stream::StreamType;
use proto::cluster_rpc;
use serde_json::Value;

use crate::traces::service_graph::v4::writer::{ReplyClass, chunk, classify, max_request_bytes};

/// The `_o2_` prefix is load-bearing: `is_internal_rollup_stream` guards user ingest by it.
pub const DIGEST_STREAM: &str = "_o2_alert_calibration_digests";

/// The stream is a pass's only record, so a lost chunk fails the pass rather than shortening it.
pub(crate) async fn write_digest_records(
    org_id: &str,
    records: Vec<Value>,
) -> Result<(), anyhow::Error> {
    let chunks = chunk(&records, max_request_bytes());
    let total = chunks.len();
    let mut lost = 0usize;
    for (index, data) in chunks.into_iter().enumerate() {
        // Retrying would duplicate the chunks that landed, since records carry no idempotency key.
        if let Err(e) = write_chunk(org_id, data).await {
            lost += 1;
            log::error!(
                "[alert_calibration] digest chunk {index} of {total} failed for {org_id}: {e}"
            );
        }
    }
    if lost > 0 {
        anyhow::bail!("{lost} of {total} digest chunks were not written for {org_id}");
    }
    Ok(())
}

async fn write_chunk(org_id: &str, data: Vec<u8>) -> Result<(), anyhow::Error> {
    let request = cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        stream_type: StreamType::Logs.as_str().to_string(),
        stream_name: DIGEST_STREAM.to_string(),
        data: Some(cluster_rpc::IngestionData { data }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        metadata: None,
    };
    let response = crate::ingestion::ingestion_service::ingest(request).await?;
    match classify(response.status_code) {
        ReplyClass::Ok => Ok(()),
        // Rows a pipeline refused leave the digest short, yet it would read as complete.
        ReplyClass::Partial | ReplyClass::Rejected | ReplyClass::Retry => anyhow::bail!(
            "ingest refused the chunk: code {} {}",
            response.status_code,
            response.message
        ),
    }
}
