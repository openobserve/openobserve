// Copyright 2024 Zinc Labs Inc.
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

use std::collections::HashMap;

use config::{
    meta::{stream::StreamType, usage::UsageType},
    metrics,
};
use infra::errors::BufferWriteError;
use opentelemetry_proto::tonic::trace::v1::{status::StatusCode, Status};

use crate::{
    common::meta::{
        stream::SchemaRecords,
        traces::{ExportTracePartialSuccess, ExportTraceServiceResponse},
    },
    service::{
        ingestion::{evaluate_trigger, write_wal_file, TriggerAlertData},
        metadata::{write, MetadataItem, MetadataType},
        usage::report_request_usage_stats,
    },
};

pub mod flusher;
pub mod otlp_http;
pub mod validator;

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";
const BLOCK_FIELDS: [&str; 4] = ["_timestamp", "duration", "start_time", "end_time"];
#[allow(clippy::too_many_arguments)]
pub async fn handle_trace_request(
    org_id: &str,
    thread_id: usize,
    traces_stream_name: &str,
    entry: HashMap<String, SchemaRecords>,
    trigger: Option<TriggerAlertData>,
    distinct_values: Vec<MetadataItem>,
    trace_index: Vec<MetadataItem>,
    mut partial_success: ExportTracePartialSuccess,
    session_id: &str,
    is_grpc: bool,
) -> Result<ExportTraceServiceResponse, BufferWriteError> {
    let start = std::time::Instant::now();

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Traces.to_string()).await;
    let traces_stream_name_with_sid = format!("{traces_stream_name}^{session_id}");
    let mut req_stats = write_wal_file(&writer, &traces_stream_name_with_sid, entry).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    let time = start.elapsed().as_secs_f64();
    req_stats.response_time = time;
    log::info!("[{session_id}] write data to wal done, elapsed: {time}");
    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    // send trace metadata
    if !trace_index.is_empty() {
        if let Err(e) = write(org_id, MetadataType::TraceListIndexer, trace_index).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    let ep = if is_grpc {
        "/grpc/export/traces"
    } else {
        "/api/org/v1/traces"
    };
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            ep,
            "200",
            org_id,
            traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            ep,
            "200",
            org_id,
            traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .inc();
    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        traces_stream_name,
        StreamType::Traces,
        UsageType::Traces,
        0,
    )
    .await;

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    let res = ExportTraceServiceResponse {
        partial_success: if partial_success.rejected_spans > 0 {
            partial_success.error_message =
                "Some spans were rejected due to exceeding the allowed retention period"
                    .to_string();
            Some(partial_success)
        } else {
            None
        },
    };

    Ok(res)
}

fn get_span_status(status: Option<Status>) -> String {
    match status {
        Some(v) => match v.code() {
            StatusCode::Ok => "OK".to_string(),
            StatusCode::Error => "ERROR".to_string(),
            StatusCode::Unset => "UNSET".to_string(),
        },
        None => "".to_string(),
    }
}
