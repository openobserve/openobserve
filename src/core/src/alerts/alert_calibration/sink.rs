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

use std::collections::HashMap;

use config::meta::stream::StreamType;
use ingestion_common::{SYSTEM_JOB_TYPE_METADATA_KEY, SystemJobType};
use proto::cluster_rpc;
use serde_json::Value;

use crate::traces::service_graph::v4::writer::{ReplyClass, chunk, classify, max_request_bytes};

/// The `_o2_` prefix is load-bearing: `is_internal_rollup_stream` guards user ingest by it.
const DIGEST_STREAM: &str = "_o2_alert_calibration_digests";
/// Left unset, the stream would keep digests for the deployment default of ten years.
const DIGEST_RETENTION_DAYS: i64 = 365;

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
    seed_retention(org_id).await;
    Ok(())
}

async fn write_chunk(org_id: &str, data: Vec<u8>) -> Result<(), anyhow::Error> {
    let response =
        crate::ingestion::ingestion_service::ingest(ingest_request(org_id, data)).await?;
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

fn ingest_request(org_id: &str, data: Vec<u8>) -> cluster_rpc::IngestionRequest {
    let job = SystemJobType::AlertCalibration.as_email_local().to_string();
    cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        stream_type: StreamType::Logs.as_str().to_string(),
        stream_name: DIGEST_STREAM.to_string(),
        data: Some(cluster_rpc::IngestionData { data }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        metadata: Some(cluster_rpc::IngestRequestMetadata {
            data: HashMap::from([(SYSTEM_JOB_TYPE_METADATA_KEY.to_string(), job)]),
        }),
    }
}

/// Only fills an unset retention, so an operator's own setting always wins.
async fn seed_retention(org_id: &str) {
    let Some(settings) = infra::schema::get_settings(org_id, DIGEST_STREAM, StreamType::Logs).await
    else {
        // The settings row can trail the first write; the next run seeds it.
        return;
    };
    if settings.data_retention != 0 {
        return;
    }
    let mut settings = (*settings).clone();
    settings.data_retention = DIGEST_RETENTION_DAYS;
    if let Err(e) =
        schema::save_stream_settings(org_id, DIGEST_STREAM, StreamType::Logs, settings).await
    {
        log::warn!(
            "[alert_calibration] could not set the digest stream's retention for {org_id}: {e}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_digest_chunk_names_its_job_in_the_ingest_metadata() {
        let request = ingest_request("acme", b"[]".to_vec());
        let job = request.metadata.unwrap().data[SYSTEM_JOB_TYPE_METADATA_KEY].clone();
        assert_eq!(
            SystemJobType::from_ingest_metadata(&job),
            Some(SystemJobType::AlertCalibration)
        );
    }
}
