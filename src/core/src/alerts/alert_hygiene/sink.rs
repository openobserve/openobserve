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

//! Alert hygiene digest sink.
//!
//! Self-ingests already-shaped digest records into the per-org
//! `_o2_alert_hygiene_digests` stream, mirroring
//! `traces::agent_signals::aggregator::write_agent_signals`. The stream is the only
//! record of a run, governed by ordinary stream retention, so every batch that fails
//! loses the findings it carried and the run is reported as failed. A record
//! `logs::ingest` rejects on its own still answers 200, but the gRPC ingest handler
//! reports how many in `failed_records`, so those records are counted as lost too.
//! `alerts::alert_hygiene` is enterprise-gated, so everything here is compiled by
//! enterprise CI but its one test runs under `--features enterprise` only, which
//! no CI job executes.

use config::meta::stream::StreamType;
use ingestion_common::SystemJobType;
use proto::cluster_rpc;

/// The `_o2_` prefix is load-bearing: `is_internal_rollup_stream` is a prefix guard.
const DIGEST_STREAM: &str = "_o2_alert_hygiene_digests";

/// A record is ~1 KB against a 32 MB `ZO_GRPC_MAX_MESSAGE_SIZE`, so this holds a batch
/// near 2 MB: margin enough for a lowered limit or a fatter record, without splitting a
/// large run into round-trips that each risk losing a slice.
const MAX_RECORDS_PER_BATCH: usize = 2_000;

/// Write already-shaped digest records to the org's `_o2_alert_hygiene_digests` stream.
pub async fn write_digest_records(
    org_id: &str,
    records: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    let record_count = records.len();
    let requests = digest_ingest_requests(org_id, &records)?;
    let mut lost: u64 = 0;
    for (index, req) in requests.into_iter().enumerate() {
        let first = index * MAX_RECORDS_PER_BATCH;
        let last = (first + MAX_RECORDS_PER_BATCH).min(record_count);
        // Aborting would guarantee a short run, and a retry would duplicate: no idempotency key.
        match write_batch(req).await {
            Ok(0) => {}
            Ok(failed) => {
                lost += failed;
                log::error!(
                    "[AlertHygiene] digest batch {index} (records {first}..{last} of \
                     {record_count}) was accepted for {org_id} but {failed} of its records were \
                     rejected"
                );
            }
            Err(e) => {
                lost += (last - first) as u64;
                log::error!(
                    "[AlertHygiene] digest batch {index} (records {first}..{last} of \
                     {record_count}) failed for {org_id}: {e}"
                );
            }
        }
    }
    if lost > 0 {
        return Err(anyhow::anyhow!(
            "{lost} of {record_count} digest records were not written for {org_id}"
        ));
    }
    Ok(())
}

async fn write_batch(req: cluster_rpc::IngestionRequest) -> Result<u64, anyhow::Error> {
    let res = crate::ingestion::ingestion_service::ingest(req)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    batch_loss(&res)
}

/// `Err` means the whole batch was refused; `Ok(n)` that `n` of its records were rejected.
fn batch_loss(res: &cluster_rpc::IngestionResponse) -> Result<u64, anyhow::Error> {
    if res.status_code != 200 {
        return Err(anyhow::anyhow!(
            "ingest refused the batch: code {} {}",
            res.status_code,
            res.message
        ));
    }
    // an absent count means the path reports no per-record status, not that none failed
    Ok(res.failed_records.unwrap_or(0))
}

fn digest_ingest_requests(
    org_id: &str,
    records: &[serde_json::Value],
) -> Result<Vec<cluster_rpc::IngestionRequest>, serde_json::Error> {
    records
        .chunks(MAX_RECORDS_PER_BATCH)
        .map(|batch| digest_ingest_request(org_id, batch))
        .collect()
}

fn digest_ingest_request(
    org_id: &str,
    records: &[serde_json::Value],
) -> Result<cluster_rpc::IngestionRequest, serde_json::Error> {
    Ok(cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        // `logs::ingest` forces Logs regardless; the search adapter reads Logs.
        stream_type: StreamType::Logs.as_str().to_string(),
        stream_name: DIGEST_STREAM.to_string(),
        data: Some(cluster_rpc::IngestionData {
            data: serde_json::to_vec(records)?,
        }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        // without this the gRPC handler attributes the write to internal_grpc@system.local
        metadata: Some(cluster_rpc::IngestRequestMetadata {
            data: SystemJobType::AlertHygieneDigest.as_ingest_metadata(),
        }),
    })
}

#[cfg(test)]
mod tests {
    use ingestion_common::SYSTEM_JOB_TYPE_METADATA_KEY;

    use super::*;

    #[test]
    fn test_digest_ingest_request_is_attributed_to_the_alert_hygiene_digest_job() {
        let req = digest_ingest_request("org", &[serde_json::json!({"a": 1})]).unwrap();
        let metadata = req
            .metadata
            .expect("digest writes must name their system job, not fall back to internal_grpc");
        assert_eq!(
            metadata.data.get(SYSTEM_JOB_TYPE_METADATA_KEY),
            Some(&"alert_hygiene_digest".to_string())
        );
        assert_eq!(req.stream_name, DIGEST_STREAM);
    }

    fn response(
        status_code: i32,
        message: &str,
        failed_records: Option<u64>,
    ) -> cluster_rpc::IngestionResponse {
        cluster_rpc::IngestionResponse {
            status_code,
            message: message.to_string(),
            failed_records,
        }
    }

    /// The gRPC handler answers 500 with the reason in the body rather than failing the call.
    #[test]
    fn a_refused_batch_is_a_failure_carrying_the_reason_the_response_gave() {
        let err = batch_loss(&response(500, "stream not found", None)).unwrap_err();
        assert_eq!(
            err.to_string(),
            "ingest refused the batch: code 500 stream not found"
        );
    }

    /// A refused batch loses every record it carried, whatever count the response gave.
    #[test]
    fn a_refused_batch_is_a_failure_even_when_it_reports_no_rejected_records() {
        assert!(batch_loss(&response(500, "stream not found", Some(0))).is_err());
    }

    #[test]
    fn an_accepted_batch_is_not_reported_as_a_failure() {
        assert_eq!(batch_loss(&response(200, "OK", Some(0))).unwrap(), 0);
    }

    /// An ingest path that reports no per-record status must not be read as a partial loss.
    #[test]
    fn an_accepted_batch_without_a_reported_count_is_treated_as_a_clean_write() {
        assert_eq!(batch_loss(&response(200, "OK", None)).unwrap(), 0);
    }

    #[test]
    fn an_accepted_batch_that_rejected_records_loses_exactly_those_records() {
        let res = response(200, "3 records rejected: bad timestamp", Some(3));
        assert_eq!(batch_loss(&res).unwrap(), 3);
    }

    /// One request per run would put a large fleet's findings over the transport limit.
    #[test]
    fn a_run_larger_than_the_batch_cap_is_written_as_more_than_one_request() {
        let records: Vec<serde_json::Value> = (0..MAX_RECORDS_PER_BATCH + 1)
            .map(|i| serde_json::json!({"rule_id": "noise", "n": i}))
            .collect();
        let requests = digest_ingest_requests("org", &records).unwrap();
        assert_eq!(requests.len(), 2);
        let batched: Vec<Vec<serde_json::Value>> = requests
            .iter()
            .map(|req| serde_json::from_slice(&req.data.as_ref().unwrap().data).unwrap())
            .collect();
        assert_eq!(batched[0].len(), MAX_RECORDS_PER_BATCH);
        assert_eq!(batched[1].len(), 1);
        assert_eq!(
            batched.concat(),
            records,
            "batching must reorder and drop nothing"
        );
    }

    #[test]
    fn a_run_at_or_under_the_batch_cap_is_written_as_one_request() {
        let records: Vec<serde_json::Value> = (0..MAX_RECORDS_PER_BATCH)
            .map(|i| serde_json::json!({"n": i}))
            .collect();
        assert_eq!(digest_ingest_requests("org", &records).unwrap().len(), 1);
    }
}
