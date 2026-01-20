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

use std::{
    collections::{HashMap, HashSet},
    io::Error,
    sync::Arc,
    time::Instant,
};

use axum::{
    Json,
    body::Bytes,
    http,
    response::{IntoResponse, Response as HttpResponse},
};
use bytes::BytesMut;
use chrono::{Duration, Utc};
use config::{
    DISTINCT_FIELDS, TIMESTAMP_COL_NAME, get_config,
    meta::{
        alerts::alert::Alert,
        otlp::OtlpRequestType,
        self_reporting::usage::{RequestStats, UsageType},
        stream::{PartitionTimeLevel, StreamParams, StreamPartition, StreamType},
    },
    metrics,
    utils::{flatten, json, schema_ext::SchemaExt, time::now_micros, util::DISTINCT_STREAM_PREFIX},
};
use infra::schema::{SchemaCache, unwrap_partition_time_level};
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::trace::v1::{
        ExportTracePartialSuccess, ExportTraceServiceRequest, ExportTraceServiceResponse,
    },
    trace::v1::{Status, status::StatusCode},
};
use prost::Message;
use serde_json::Map;

pub mod service_graph;

#[cfg(feature = "cloud")]
use crate::service::stream::get_stream;
use crate::{
    common::meta::{
        http::HttpResponse as MetaHttpResponse,
        ingestion::IngestUser,
        stream::SchemaRecords,
        traces::{Event, Span, SpanLink, SpanLinkContext, SpanRefType},
    },
    handler::http::router::ERROR_HEADER,
    service::{
        alerts::alert::AlertExt,
        format_stream_name,
        ingestion::{
            TriggerAlertData, check_ingestion_allowed, evaluate_trigger, get_thread_id,
            grpc::get_val, write_file,
        },
        logs::O2IngestJsonData,
        metadata::{
            MetadataItem, MetadataType, distinct_values::DvItem, trace_list_index::TraceListItem,
            write,
        },
        schema::{check_for_schema, stream_schema_exists},
        self_reporting::report_request_usage_stats,
    },
};

const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";
const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const BLOCK_FIELDS: [&str; 4] = ["_timestamp", "duration", "start_time", "end_time"];
// ref https://opentelemetry.io/docs/specs/otel/trace/api/#retrieving-the-traceid-and-spanid
const SPAN_ID_BYTES_COUNT: usize = 8;
const TRACE_ID_BYTES_COUNT: usize = 16;
const ATTR_STATUS_CODE: &str = "status_code";
const ATTR_STATUS_MESSAGE: &str = "status_message";

pub async fn otlp_proto(
    org_id: &str,
    body: Bytes,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<HttpResponse, Error> {
    let request = match ExportTraceServiceRequest::decode(body) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[TRACES:OTLP] Invalid proto: org_id: {org_id}, error: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid proto: {e}")));
        }
    };
    match handle_otlp_request(
        org_id,
        request,
        OtlpRequestType::HttpProtobuf,
        in_stream_name,
        user,
    )
    .await
    {
        Ok(v) => Ok(v),
        Err(e) => {
            log::error!(
                "[TRACES:OTLP] Error while handling grpc trace request: org_id: {org_id}, error: {e}"
            );
            Err(e)
        }
    }
}

pub async fn otlp_json(
    org_id: &str,
    body: Bytes,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<HttpResponse, Error> {
    let request = match serde_json::from_slice::<ExportTraceServiceRequest>(body.as_ref()) {
        Ok(req) => req,
        Err(e) => {
            log::error!("[TRACES:OTLP] Invalid json: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid json: {e}")));
        }
    };
    match handle_otlp_request(
        org_id,
        request,
        OtlpRequestType::HttpJson,
        in_stream_name,
        user,
    )
    .await
    {
        Ok(v) => Ok(v),
        Err(e) => {
            log::error!("[TRACES:OTLP] Error while handling http trace request: {e}");
            Err(e)
        }
    }
}

pub async fn handle_otlp_request(
    org_id: &str,
    request: ExportTraceServiceRequest,
    req_type: OtlpRequestType,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<HttpResponse, Error> {
    // check system resource
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Traces, None).await {
        // we do not want to log trial period expired errors
        if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            return Ok(MetaHttpResponse::too_many_requests(e));
        } else {
            log::error!("[TRACES:OTLP] ingestion error: {e}");
            return Ok((
                http::StatusCode::SERVICE_UNAVAILABLE,
                Json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                )),
            )
                .into_response());
        }
    }

    #[cfg(feature = "cloud")]
    {
        match super::organization::is_org_in_free_trial_period(org_id).await {
            Ok(false) => {
                return Ok(MetaHttpResponse::forbidden(format!(
                    "org {org_id} has expired its trial period"
                )));
            }
            Err(e) => {
                return Ok(MetaHttpResponse::forbidden(e.to_string()));
            }
            _ => {}
        }
    }

    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    let cfg = get_config();
    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name.to_string()),
        None => "default".to_owned(),
    };
    let now = now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;

    // Start retrieving associated pipeline and construct pipeline params
    let stream_param = StreamParams::new(org_id, &traces_stream_name, StreamType::Traces);
    let executable_pipeline =
        crate::service::ingestion::get_stream_executable_pipeline(&stream_param).await;
    let mut stream_pipeline_inputs = Vec::new();
    // End pipeline params construction

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    crate::service::ingestion::get_uds_and_original_data_streams(
        std::slice::from_ref(&stream_param),
        &mut user_defined_schema_map,
        &mut streams_need_original_map,
        &mut streams_need_all_values_map,
    )
    .await;
    // End get user defined schema

    let mut service_name: String = traces_stream_name.to_string();
    let res_spans = request.resource_spans;
    let mut json_data_by_stream = HashMap::new();
    let mut partial_success = ExportTracePartialSuccess::default();
    for res_span in res_spans {
        let mut service_att_map: HashMap<String, json::Value> = HashMap::new();
        if let Some(resource) = res_span.resource {
            for res_attr in resource.attributes {
                if res_attr.key.eq(SERVICE_NAME) {
                    let loc_service_name = get_val(&res_attr.value.as_ref());
                    if let Some(name) = loc_service_name.as_str() {
                        service_name = name.to_string();
                        service_att_map.insert(SERVICE_NAME.to_string(), loc_service_name);
                    }
                } else {
                    service_att_map.insert(
                        format!("{}_{}", SERVICE, res_attr.key),
                        get_val(&res_attr.value.as_ref()),
                    );
                }
            }
        }
        let inst_resources = res_span.scope_spans;
        for inst_span in inst_resources {
            let spans = inst_span.spans;
            for span in spans {
                if span.trace_id.len() != TRACE_ID_BYTES_COUNT {
                    log::error!("[TRACES:OTLP] skipping span with invalid trace id");
                    partial_success.rejected_spans += 1;
                    continue;
                }
                let trace_id: String =
                    TraceId::from_bytes(span.trace_id.try_into().unwrap()).to_string();
                if span.span_id.len() != SPAN_ID_BYTES_COUNT {
                    log::error!(
                        "[TRACES:OTLP] skipping span with invalid span id, trace_id: {trace_id}"
                    );
                    partial_success.rejected_spans += 1;
                    continue;
                }
                let span_id: String =
                    SpanId::from_bytes(span.span_id.try_into().unwrap()).to_string();
                let mut span_ref = HashMap::new();
                if !span.parent_span_id.is_empty()
                    && span.parent_span_id.len() == SPAN_ID_BYTES_COUNT
                {
                    span_ref.insert(PARENT_TRACE_ID.to_string(), trace_id.clone());
                    span_ref.insert(
                        PARENT_SPAN_ID.to_string(),
                        SpanId::from_bytes(span.parent_span_id.try_into().unwrap()).to_string(),
                    );
                    span_ref.insert(REF_TYPE.to_string(), format!("{:?}", SpanRefType::ChildOf));
                }
                let start_time: u64 = span.start_time_unix_nano;
                let end_time: u64 = span.end_time_unix_nano;
                let mut span_att_map: HashMap<String, json::Value> = HashMap::new();
                for span_att in span.attributes {
                    let mut key = span_att.key;
                    if BLOCK_FIELDS.contains(&key.as_str()) {
                        key = format!("attr_{key}");
                    }
                    span_att_map.insert(key, get_val(&span_att.value.as_ref()));
                }

                // special addition for https://github.com/openobserve/openobserve/issues/4851
                // we set the status (error/non-error) properly, but skip the message
                // however, that can be useful when debugging with traces, so we
                // extract that as an attribute here.
                if let Some(ref status) = span.status {
                    span_att_map.insert(ATTR_STATUS_CODE.into(), status.code.into());
                    span_att_map.insert(ATTR_STATUS_MESSAGE.into(), status.message.clone().into());
                }

                let mut events = vec![];
                for event in span.events {
                    let mut event_att_map: HashMap<String, json::Value> = HashMap::new();
                    for event_att in event.attributes {
                        event_att_map.insert(event_att.key, get_val(&event_att.value.as_ref()));
                    }
                    events.push(Event {
                        name: event.name,
                        _timestamp: event.time_unix_nano,
                        attributes: event_att_map,
                    })
                }

                let mut links = vec![];
                for link in span.links {
                    let mut link_att_map: HashMap<String, json::Value> = HashMap::new();
                    for link_att in link.attributes {
                        link_att_map.insert(link_att.key, get_val(&link_att.value.as_ref()));
                    }
                    if link.span_id.len() != SPAN_ID_BYTES_COUNT {
                        log::error!(
                            "[TRACES:OTLP] skipping link with invalid span id, trace_id: {trace_id}"
                        );
                        continue;
                    }
                    let span_id: String =
                        SpanId::from_bytes(link.span_id.try_into().unwrap()).to_string();
                    if link.trace_id.len() != TRACE_ID_BYTES_COUNT {
                        log::error!(
                            "[TRACES:OTLP] skipping link with invalid trace id, trace_id: {trace_id}"
                        );
                        continue;
                    }
                    let trace_id: String =
                        TraceId::from_bytes(link.trace_id.try_into().unwrap()).to_string();
                    links.push(SpanLink {
                        context: SpanLinkContext {
                            span_id,
                            trace_id,
                            trace_flags: Some(link.flags),
                            trace_state: Some(link.trace_state),
                        },
                        attributes: link_att_map,
                        dropped_attributes_count: link.dropped_attributes_count,
                    })
                }

                let timestamp = (start_time / 1000) as i64;
                if timestamp < min_ts {
                    log::error!(
                        "[TRACES:OTLP] skipping span with timestamp older than allowed retention period, trace_id: {trace_id}"
                    );
                    partial_success.rejected_spans += 1;
                    continue;
                }
                if timestamp > max_ts {
                    log::error!(
                        "[TRACES:OTLP] skipping span with timestamp newer than allowed retention period, trace_id: {trace_id}"
                    );
                    partial_success.rejected_spans += 1;
                    continue;
                }
                let local_val = Span {
                    trace_id: trace_id.clone(),
                    span_id: span_id.clone(),
                    span_kind: span.kind.to_string(),
                    span_status: get_span_status(span.status.clone()),
                    operation_name: span.name.clone(),
                    start_time,
                    end_time,
                    duration: (end_time - start_time) / 1000, // microseconds
                    reference: span_ref.clone(),
                    service_name: service_name.clone(),
                    attributes: span_att_map.clone(),
                    service: service_att_map.clone(),
                    flags: 1, // TODO add appropriate value
                    events: json::to_string(&events).unwrap(),
                    links: json::to_string(&links).unwrap(),
                };

                // Service graph processing is handled by periodic daemon
                // No inline processing during trace ingestion

                let mut value: json::Value = json::to_value(local_val).unwrap();
                // add timestamp
                value.as_object_mut().unwrap().insert(
                    TIMESTAMP_COL_NAME.to_string(),
                    json::Value::Number(timestamp.into()),
                );

                if executable_pipeline.is_some() {
                    stream_pipeline_inputs.push(value);
                } else {
                    // JSON Flattening
                    value = flatten::flatten(value).map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
                    })?;

                    // get json object
                    let mut record_val = match value.take() {
                        json::Value::Object(v) => v,
                        _ => {
                            log::error!(
                                "[TRACES:OTLP] stream did not receive a valid json object, trace_id: {trace_id}"
                            );
                            return Ok((
                                http::StatusCode::INTERNAL_SERVER_ERROR,
                                [(ERROR_HEADER, format!("[trace_id: {trace_id}] stream did not receive a valid json object"))],
                                Json(MetaHttpResponse::error(
                                    http::StatusCode::INTERNAL_SERVER_ERROR,
                                    "stream did not receive a valid json object",
                                )),
                            ).into_response());
                        }
                    };

                    if let Some(Some(fields)) = user_defined_schema_map.get(&traces_stream_name) {
                        record_val = crate::service::ingestion::refactor_map(record_val, fields);
                    }

                    let (ts_data, _) = json_data_by_stream
                        .entry(traces_stream_name.to_string())
                        .or_insert((Vec::new(), None));
                    ts_data.push((timestamp, record_val));
                }
            }
        }
    }

    // batch process records through pipeline
    if let Some(exec_pl) = &executable_pipeline {
        let records = stream_pipeline_inputs;

        let records_count = records.len();
        match exec_pl
            .process_batch(org_id, records, in_stream_name.map(String::from))
            .await
        {
            Err(e) => {
                log::error!(
                    "[TRACES:OTLP] pipeline({org_id}/{traces_stream_name}) batch execution error: {e}."
                );
                partial_success.rejected_spans += records_count as i64;
                partial_success.error_message = format!("Pipeline batch execution error: {e}");
            }
            Ok(pl_results) => {
                log::debug!(
                    "[TRACES:OTLP] pipeline returned results map of size: {}",
                    pl_results.len()
                );
                for (stream_params, stream_pl_results) in pl_results {
                    if stream_params.stream_type != StreamType::Traces {
                        log::warn!(
                            "[TRACES:OTLP] stream {stream_params:?} returned by pipeline is not a Trace stream. Records dropped"
                        );
                        continue;
                    }

                    for (_idx, mut res) in stream_pl_results {
                        // get json object
                        let mut record_val = match res.take() {
                            json::Value::Object(v) => v,
                            _ => {
                                log::error!(
                                    "[TRACES:OTLP] stream did not receive a valid json object"
                                );
                                return Ok((
                                    http::StatusCode::INTERNAL_SERVER_ERROR,
                                    [(ERROR_HEADER, "stream did not receive a valid json object")],
                                    Json(MetaHttpResponse::error(
                                        http::StatusCode::INTERNAL_SERVER_ERROR,
                                        "stream did not receive a valid json object",
                                    )),
                                )
                                    .into_response());
                            }
                        };

                        if let Some(Some(fields)) =
                            user_defined_schema_map.get(&stream_params.stream_name.to_string())
                        {
                            record_val =
                                crate::service::ingestion::refactor_map(record_val, fields);
                        }

                        log::debug!(
                            "[TRACES:OTLP] pipeline result for stream: {} got {} records",
                            stream_params.stream_name,
                            record_val.len()
                        );

                        let Some(timestamp) = record_val
                            .get(TIMESTAMP_COL_NAME)
                            .and_then(|ts| ts.as_i64())
                        else {
                            log::error!(
                                "[TRACES:OTLP] skipping span due to missing inserted timestamp",
                            );
                            partial_success.rejected_spans += 1;
                            continue;
                        };
                        let (ts_data, _) = json_data_by_stream
                            .entry(stream_params.stream_name.to_string())
                            .or_insert((Vec::new(), None));
                        ts_data.push((timestamp, record_val));
                    }
                }
            }
        }
    }

    // if no data, fast return
    if json_data_by_stream.is_empty() {
        return format_response(partial_success, req_type);
    }

    if let Err(e) = write_traces_by_stream(
        org_id,
        (started_at, &start),
        json_data_by_stream,
        &user.to_email(),
    )
    .await
    {
        log::error!("Error while writing traces: {e}");
        // Check if this is a schema validation error (InvalidData)
        let status_code = if e.kind() == std::io::ErrorKind::InvalidData {
            http::StatusCode::BAD_REQUEST
        } else {
            http::StatusCode::INTERNAL_SERVER_ERROR
        };
        return Ok((
            status_code,
            [(ERROR_HEADER, format!("error while writing trace data: {e}"))],
            Json(MetaHttpResponse::error(
                status_code,
                format!("error while writing trace data: {e}"),
            )),
        )
            .into_response());
    }

    let time = start.elapsed().as_secs_f64();
    let ep = match req_type {
        OtlpRequestType::Grpc => "/grpc/otlp/traces",
        _ => "/api/otlp/v1/traces",
    };

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[ep, "200", org_id, StreamType::Traces.as_str(), "", ""])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[ep, "200", org_id, StreamType::Traces.as_str(), "", ""])
        .inc();

    format_response(partial_success, req_type)
}

/// This ingestion handler is designated to ScheduledPipeline's gPRC ingestion service.
/// Only accepts data that has already been validated against the otlp protocol.
/// Please use other ingestion handlers when ingesting raw trace data.
/// For internal service only, so don't need to check UDS
pub async fn ingest_json(
    org_id: &str,
    body: Bytes,
    req_type: OtlpRequestType,
    traces_stream_name: &str,
    user: IngestUser,
) -> Result<HttpResponse, Error> {
    // check system resource
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Traces, None).await {
        // we do not want to log trial period expired errors
        if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            return Ok(MetaHttpResponse::too_many_requests(e));
        } else {
            log::error!("[TRACES:JSON] ingestion error: {e}");
            return Ok((
                http::StatusCode::SERVICE_UNAVAILABLE,
                Json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                )),
            )
                .into_response());
        }
    }

    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    let cfg = get_config();
    let min_ts = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let max_ts = (Utc::now() + Duration::try_hours(cfg.limit.ingest_allowed_in_future).unwrap())
        .timestamp_micros();

    let json_values: Vec<json::Value> = json::from_slice(&body)?;
    let mut json_data_by_stream = HashMap::new();
    let mut partial_success = ExportTracePartialSuccess::default();
    for mut value in json_values {
        let timestamp = value[TIMESTAMP_COL_NAME].as_i64().unwrap_or(
            value["start_time"]
                .as_i64()
                .map(|ts| ts / 1000)
                .unwrap_or(min_ts),
        );
        let trace_id = value["trace_id"].to_string();
        if timestamp < min_ts {
            log::error!(
                "[TRACES:JSON] skipping span with timestamp older than allowed retention period, trace_id: {}",
                &trace_id
            );
            partial_success.rejected_spans += 1;
            continue;
        }
        if timestamp > max_ts {
            log::error!(
                "[TRACES:JSON] skipping span with timestamp newer than allowed retention period, trace_id: {}",
                &trace_id
            );
            partial_success.rejected_spans += 1;
            continue;
        }

        // JSON Flattening
        value = flatten::flatten(value)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;

        // get json object
        let mut record_val = match value.take() {
            json::Value::Object(v) => v,
            _ => {
                log::error!(
                    "[TRACES:JSON] stream did not receive a valid json object, trace_id: {}",
                    &trace_id
                );
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(
                        ERROR_HEADER,
                        format!(
                            "[trace_id: {trace_id}] stream did not receive a valid json object"
                        ),
                    )],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        "stream did not receive a valid json object",
                    )),
                )
                    .into_response());
            }
        };

        // add timestamp
        record_val.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number(timestamp.into()),
        );
        let (ts_data, _) = json_data_by_stream
            .entry(traces_stream_name.to_string())
            .or_insert((Vec::new(), None));
        ts_data.push((timestamp, record_val));
    }

    // if no data, fast return
    if json_data_by_stream.is_empty() {
        return format_response(partial_success, req_type);
    }

    if let Err(e) = write_traces_by_stream(
        org_id,
        (started_at, &start),
        json_data_by_stream,
        &user.to_email(),
    )
    .await
    {
        log::error!("Error while writing traces: {e}");
        // Check if this is a schema validation error (InvalidData)
        let status_code = if e.kind() == std::io::ErrorKind::InvalidData {
            http::StatusCode::BAD_REQUEST
        } else {
            http::StatusCode::INTERNAL_SERVER_ERROR
        };
        return Ok((
            status_code,
            [(ERROR_HEADER, format!("error while writing trace data: {e}"))],
            Json(MetaHttpResponse::error(
                status_code,
                format!("error while writing trace data: {e}"),
            )),
        )
            .into_response());
    }

    let time = start.elapsed().as_secs_f64();
    let ep = match req_type {
        OtlpRequestType::Grpc => "/grpc/traces/json",
        _ => "/api/traces/json",
    };

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[ep, "200", org_id, StreamType::Traces.as_str(), "", ""])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[ep, "200", org_id, StreamType::Traces.as_str(), "", ""])
        .inc();

    format_response(partial_success, req_type)
}

fn get_span_status(status: Option<Status>) -> String {
    match status {
        Some(v) => match v.code() {
            StatusCode::Ok => "OK".to_string(),
            StatusCode::Error => "ERROR".to_string(),
            StatusCode::Unset => "UNSET".to_string(),
        },
        // unset is the default status for span - https://opentelemetry.io/docs/languages/go/instrumentation/#set-span-status
        None => "UNSET".to_string(),
    }
}

fn format_response(
    mut partial_success: ExportTracePartialSuccess,
    req_type: OtlpRequestType,
) -> Result<HttpResponse, Error> {
    let partial = partial_success.rejected_spans > 0;

    let res = if partial {
        partial_success.error_message =
            "Some spans were rejected due to exceeding the allowed retention period".to_string();
        ExportTraceServiceResponse {
            partial_success: Some(partial_success),
        }
    } else {
        ExportTraceServiceResponse::default()
    };

    match req_type {
        OtlpRequestType::HttpJson => Ok(if partial {
            (http::StatusCode::PARTIAL_CONTENT, Json(res)).into_response()
        } else {
            MetaHttpResponse::json(res)
        }),
        _ => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            Ok((
                http::StatusCode::OK,
                [(http::header::CONTENT_TYPE, "application/x-protobuf")],
                out.to_vec(),
            )
                .into_response())
        }
    }
}

async fn write_traces_by_stream(
    org_id: &str,
    time_stats: (i64, &Instant),
    json_data_by_stream: HashMap<String, O2IngestJsonData>,
    user_email: &str,
) -> Result<(), Error> {
    for (traces_stream_name, (json_data, fn_num)) in json_data_by_stream {
        // for cloud, we want to sent event when user creates a new stream
        #[cfg(feature = "cloud")]
        if get_stream(org_id, &traces_stream_name, StreamType::Traces)
            .await
            .is_none()
        {
            let org = super::organization::get_org(org_id).await.unwrap();

            super::self_reporting::cloud_events::enqueue_cloud_event(
                super::self_reporting::cloud_events::CloudEvent {
                    org_id: org.identifier.clone(),
                    org_name: org.name.clone(),
                    org_type: org.org_type.clone(),
                    user: None,
                    event: super::self_reporting::cloud_events::EventType::StreamCreated,
                    subscription_type: None,
                    stream_name: Some(traces_stream_name.clone()),
                },
            )
            .await;
        }

        let mut req_stats = match write_traces(org_id, &traces_stream_name, json_data).await {
            Ok(v) => v,
            Err(e) => {
                return Err(e);
            }
        };
        let time = time_stats.1.elapsed().as_secs_f64();
        req_stats.response_time = time;
        req_stats.user_email = if user_email.is_empty() {
            None
        } else {
            Some(user_email.to_string())
        };
        // metric + data usage
        report_request_usage_stats(
            req_stats,
            org_id,
            &traces_stream_name,
            StreamType::Traces,
            UsageType::Traces,
            fn_num.map_or(0, |cnt| cnt as u16),
            time_stats.0,
        )
        .await;
    }
    Ok(())
}

async fn write_traces(
    org_id: &str,
    stream_name: &str,
    json_data: Vec<(i64, json::Map<String, json::Value>)>,
) -> Result<RequestStats, Error> {
    let cfg = get_config();
    // get schema and stream settings
    let mut traces_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let stream_schema = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
    )
    .await;

    let stream_settings = infra::schema::get_settings(org_id, stream_name, StreamType::Traces)
        .await
        .unwrap_or_default();

    let mut partition_keys: Vec<StreamPartition> = vec![];
    let mut partition_time_level =
        PartitionTimeLevel::from(cfg.limit.traces_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            org_id,
            &StreamType::Traces,
            stream_name,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Traces);
    }

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    crate::service::ingestion::get_stream_alerts(
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: stream_name.to_owned().into(),
            stream_type: StreamType::Traces,
        }],
        &mut stream_alerts_map,
    )
    .await;
    let cur_stream_alerts = stream_alerts_map.get(&format!(
        "{}/{}/{}",
        org_id,
        StreamType::Traces,
        stream_name
    ));
    let mut triggers: TriggerAlertData =
        Vec::with_capacity(cur_stream_alerts.map_or(0, |v| v.len()));
    let mut evaluated_alerts = HashSet::new();
    // End get stream alert

    // Start check for schema
    let min_timestamp = json_data.iter().map(|(ts, _)| ts).min().unwrap();
    let (_schema_evolution, _infer_schema) = check_for_schema(
        org_id,
        stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
        json_data.iter().map(|(_, v)| v).collect(),
        *min_timestamp,
        false, // is_derived is false for traces
    )
    .await
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    let record_schema = traces_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());
    let record_schema = Arc::new(record_schema);
    let schema_key = record_schema.hash_key();

    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);
    let mut trace_index_values = Vec::with_capacity(json_data.len());

    // Start write data
    for (timestamp, record_val) in json_data {
        // get service_name
        let service_name = json::get_string_value(record_val.get("service_name").unwrap());
        // get distinct_value item
        if stream_settings.enable_distinct_fields {
            let mut map = Map::new();
            for field in DISTINCT_FIELDS.iter().chain(
                stream_settings
                    .distinct_value_fields
                    .iter()
                    .map(|f| &f.name),
            ) {
                if let Some(val) = record_val.get(field) {
                    map.insert(field.clone(), val.clone());
                }
            }
            if !map.is_empty() {
                distinct_values.push(MetadataItem::DistinctValues(DvItem {
                    stream_type: StreamType::Traces,
                    stream_name: stream_name.to_string(),
                    value: map,
                }));
            }
        }

        // build trace metadata
        let trace_id = record_val
            .get("trace_id")
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        trace_index_values.push(MetadataItem::TraceListIndexer(TraceListItem {
            _timestamp: timestamp,
            stream_name: stream_name.to_string(),
            service_name: service_name.to_string(),
            trace_id,
        }));

        // Start check for alert trigger
        if let Some(alerts) = cur_stream_alerts
            && triggers.len() < alerts.len()
        {
            let alert_end_time = now_micros();
            for alert in alerts {
                let key = format!(
                    "{}/{}/{}/{}",
                    org_id,
                    StreamType::Traces,
                    stream_name,
                    alert.get_unique_key()
                );
                // check if alert already evaluated
                if evaluated_alerts.contains(&key) {
                    continue;
                }

                if let Ok(Some(data)) = alert
                    .evaluate(Some(&record_val), (None, alert_end_time), None)
                    .await
                    .map(|res| res.data)
                {
                    triggers.push((alert.clone(), data));
                    evaluated_alerts.insert(key);
                }
            }
        }
        // End check for alert trigger

        // get hour key
        let hour_key = super::ingestion::get_write_partition_key(
            timestamp,
            &partition_keys,
            partition_time_level,
            &record_val,
            Some(&schema_key),
        );

        let hour_buf = data_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.clone(),
            schema: record_schema.clone(),
            records: vec![],
            records_size: 0,
        });
        let record_val = json::Value::Object(record_val);
        let record_size = json::estimate_json_bytes(&record_val);
        hour_buf.records.push(Arc::new(record_val));
        hour_buf.records_size += record_size;
    }

    // write data to wal
    let writer = ingester::get_writer(
        get_thread_id(),
        org_id,
        StreamType::Traces.as_str(),
        stream_name,
    )
    .await;
    let req_stats = write_file(
        &writer,
        org_id,
        stream_name,
        data_buf,
        !cfg.common.wal_fsync_disabled,
    )
    .await
    .map_err(|e| {
        log::error!("Error while writing traces: {e}");
        std::io::Error::other(e.to_string())
    })?;

    // send distinct_values
    if !distinct_values.is_empty()
        && !stream_name.starts_with(DISTINCT_STREAM_PREFIX)
        && stream_settings.enable_distinct_fields
        && let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await
    {
        log::error!("Error while writing distinct values: {e}");
    }

    // send trace metadata
    if cfg.common.traces_list_index_enabled
        && !trace_index_values.is_empty()
        && let Err(e) = write(org_id, MetadataType::TraceListIndexer, trace_index_values).await
    {
        log::error!("Error while writing trace_index values: {e}");
    }

    // only one trigger per request
    evaluate_trigger(triggers).await;

    Ok(req_stats)
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;
    use opentelemetry_proto::tonic::trace::v1::{Status, status::StatusCode};

    use crate::service::ingestion::grpc::get_val_for_attr;

    #[test]
    fn test_get_val_for_attr() {
        let in_val = 10.00;
        let input = json!({ "key": in_val });
        let resp = get_val_for_attr(input);
        assert_eq!(resp.as_str().unwrap(), in_val.to_string());
    }

    #[test]
    fn test_get_span_status_ok() {
        let status = Status {
            code: StatusCode::Ok as i32,
            message: "success".to_string(),
        };
        assert_eq!(super::get_span_status(Some(status)), "OK");
    }

    #[test]
    fn test_get_span_status_error() {
        let status = Status {
            code: StatusCode::Error as i32,
            message: "error occurred".to_string(),
        };
        assert_eq!(super::get_span_status(Some(status)), "ERROR");
    }

    #[test]
    fn test_get_span_status_unset() {
        let status = Status {
            code: StatusCode::Unset as i32,
            message: "".to_string(),
        };
        assert_eq!(super::get_span_status(Some(status)), "UNSET");
    }

    #[test]
    fn test_get_span_status_none() {
        // Test None status (default case)
        assert_eq!(super::get_span_status(None), "UNSET");
    }

    #[test]
    fn test_format_response_success() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "".to_string(),
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpJson,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK);
    }

    #[test]
    fn test_format_response_partial_success() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 5,
                error_message: "Some spans rejected".to_string(),
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpJson,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::PARTIAL_CONTENT);
    }

    #[test]
    fn test_format_response_grpc() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "".to_string(),
            };

        let result =
            super::format_response(partial_success, config::meta::otlp::OtlpRequestType::Grpc);
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "application/x-protobuf"
        );
    }

    #[test]
    fn test_format_response_http_protobuf() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "".to_string(),
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpProtobuf,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "application/x-protobuf"
        );
    }

    // Test format_response with different OtlpRequestType variants
    #[test]
    fn test_format_response_unknown_type() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "".to_string(),
            };

        // Test with an unknown request type (should default to protobuf)
        let result =
            super::format_response(partial_success, config::meta::otlp::OtlpRequestType::Grpc);
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response.headers().get("content-type").unwrap(),
            "application/x-protobuf"
        );
    }

    // Test format_response error message for partial success
    #[test]
    fn test_format_response_error_message() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 3,
                error_message: "original message".to_string(),
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpJson,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::PARTIAL_CONTENT);
    }

    // Test get_span_status with invalid status codes
    #[test]
    fn test_get_span_status_invalid_code() {
        let status = Status {
            code: 999, // Invalid status code
            message: "invalid".to_string(),
        };
        // Should handle gracefully and return a valid string
        let result = super::get_span_status(Some(status));
        assert!(!result.is_empty());
        assert!(result == "OK" || result == "ERROR" || result == "UNSET");
    }

    // Test get_span_status with empty message
    #[test]
    fn test_get_span_status_empty_message() {
        let status = Status {
            code: StatusCode::Ok as i32,
            message: "".to_string(),
        };
        assert_eq!(super::get_span_status(Some(status)), "OK");
    }

    // Test get_span_status with long message
    #[test]
    fn test_get_span_status_long_message() {
        let long_message = "a".repeat(1000);
        let status = Status {
            code: StatusCode::Error as i32,
            message: long_message,
        };
        assert_eq!(super::get_span_status(Some(status)), "ERROR");
    }

    // Test constants and validation logic

    #[test]
    fn test_block_fields() {
        let block_fields = &super::BLOCK_FIELDS;
        assert_eq!(block_fields.len(), 4);
        assert!(block_fields.contains(&"_timestamp"));
        assert!(block_fields.contains(&"duration"));
        assert!(block_fields.contains(&"start_time"));
        assert!(block_fields.contains(&"end_time"));
    }

    // Test validation helper functions

    #[test]
    fn test_invalid_trace_id_length() {
        let invalid_trace_id = [0u8; 10]; // Wrong length
        assert_ne!(invalid_trace_id.len(), super::TRACE_ID_BYTES_COUNT);
    }

    #[test]
    fn test_invalid_span_id_length() {
        let invalid_span_id = [0u8; 5]; // Wrong length
        assert_ne!(invalid_span_id.len(), super::SPAN_ID_BYTES_COUNT);
    }

    // Test timestamp validation logic (without actual ingestion)
    #[test]
    fn test_timestamp_conversion() {
        let start_time_nano = 1_640_995_200_000_000_000u64; // 2022-01-01 00:00:00 UTC in nanoseconds
        let timestamp_micros = (start_time_nano / 1000) as i64;
        assert_eq!(timestamp_micros, 1_640_995_200_000_000);
    }

    #[test]
    fn test_duration_calculation() {
        let start_time = 1_640_995_200_000_000_000u64;
        let end_time = 1_640_995_201_500_000_000u64; // 1.5 seconds later
        let duration_micros = (end_time - start_time) / 1000;
        assert_eq!(duration_micros, 1_500_000); // 1.5 seconds in microseconds
    }

    // Test attribute key transformation for blocked fields
    #[test]
    fn test_blocked_field_transformation() {
        let blocked_field = "_timestamp";
        let transformed = if super::BLOCK_FIELDS.contains(&blocked_field) {
            format!("attr_{blocked_field}")
        } else {
            blocked_field.to_string()
        };
        assert_eq!(transformed, "attr__timestamp");
    }

    #[test]
    fn test_non_blocked_field_no_transformation() {
        let normal_field = "http.method";
        let transformed = if super::BLOCK_FIELDS.contains(&normal_field) {
            format!("attr_{normal_field}")
        } else {
            normal_field.to_string()
        };
        assert_eq!(transformed, "http.method");
    }

    // Test service name extraction logic
    #[test]
    fn test_service_attribute_key_transformation() {
        let service_attr_key = "version";
        let transformed = format!("{}_{}", super::SERVICE, service_attr_key);
        assert_eq!(transformed, "service_version");
    }

    // Test span reference type formatting
    #[test]
    fn test_span_ref_type_format() {
        use crate::common::meta::traces::SpanRefType;
        let ref_type = format!("{:?}", SpanRefType::ChildOf);
        assert_eq!(ref_type, "ChildOf");
    }

    // Test edge cases for format_response function
    #[test]
    fn test_format_response_zero_rejected_spans() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: 0,
                error_message: "Some error".to_string(), // Error message but no rejected spans
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpJson,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK); // Should be OK, not partial
    }

    #[test]
    fn test_format_response_negative_rejected_spans() {
        let partial_success =
            opentelemetry_proto::tonic::collector::trace::v1::ExportTracePartialSuccess {
                rejected_spans: -1, // Negative value
                error_message: "".to_string(),
            };

        let result = super::format_response(
            partial_success,
            config::meta::otlp::OtlpRequestType::HttpJson,
        );
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.status(), http::StatusCode::OK); // Negative is treated as no rejection
    }

    // Test span status edge cases
    #[test]
    fn test_get_span_status_all_variants() {
        // Test all possible StatusCode values
        let ok_status = Status {
            code: StatusCode::Ok as i32,
            message: "".to_string(),
        };
        assert_eq!(super::get_span_status(Some(ok_status)), "OK");

        let error_status = Status {
            code: StatusCode::Error as i32,
            message: "".to_string(),
        };
        assert_eq!(super::get_span_status(Some(error_status)), "ERROR");

        let unset_status = Status {
            code: StatusCode::Unset as i32,
            message: "".to_string(),
        };
        assert_eq!(super::get_span_status(Some(unset_status)), "UNSET");
    }

    // Test JSON value creation and validation
    #[test]
    fn test_json_value_creation() {
        use config::utils::json::json;

        let test_value = json!({
            "trace_id": "1234567890abcdef1234567890abcdef",
            "span_id": "abcdef1234567890",
            "operation_name": "test_operation",
            "service_name": "test_service",
            "duration": 1500,
            "start_time": 1640995200000000000u64,
            "end_time": 1640995201500000000u64
        });

        assert!(test_value.is_object());
        assert_eq!(test_value["trace_id"], "1234567890abcdef1234567890abcdef");
        assert_eq!(test_value["span_id"], "abcdef1234567890");
        assert_eq!(test_value["duration"], 1500);
    }

    // Test empty collections handling
    #[test]
    fn test_empty_events_serialization() {
        use config::utils::json;
        let empty_events: Vec<crate::common::meta::traces::Event> = vec![];
        let serialized = json::to_string(&empty_events).unwrap();
        assert_eq!(serialized, "[]");
    }

    #[test]
    fn test_empty_links_serialization() {
        use config::utils::json;
        let empty_links: Vec<crate::common::meta::traces::SpanLink> = vec![];
        let serialized = json::to_string(&empty_links).unwrap();
        assert_eq!(serialized, "[]");
    }

    // Test error message formatting
    #[test]
    fn test_error_message_formatting() {
        let error_msg = format!("Invalid proto: {}", "test error");
        assert_eq!(error_msg, "Invalid proto: test error");

        let trace_error = format!(
            "[trace_id: {}] stream did not receive a valid json object",
            "test_trace_id"
        );
        assert_eq!(
            trace_error,
            "[trace_id: test_trace_id] stream did not receive a valid json object"
        );
    }

    // Test TraceId and SpanId conversions
    #[test]
    fn test_trace_id_conversion() {
        use opentelemetry::trace::TraceId;

        // Test valid trace ID conversion
        let trace_bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let trace_id = TraceId::from_bytes(trace_bytes);
        let trace_id_string = trace_id.to_string();

        assert_eq!(trace_bytes.len(), super::TRACE_ID_BYTES_COUNT);
        assert!(!trace_id_string.is_empty());
        assert_eq!(trace_id_string.len(), 32); // Hex string representation
    }

    #[test]
    fn test_span_id_conversion() {
        use opentelemetry::trace::SpanId;

        // Test valid span ID conversion
        let span_bytes = [1, 2, 3, 4, 5, 6, 7, 8];
        let span_id = SpanId::from_bytes(span_bytes);
        let span_id_string = span_id.to_string();

        assert_eq!(span_bytes.len(), super::SPAN_ID_BYTES_COUNT);
        assert!(!span_id_string.is_empty());
        assert_eq!(span_id_string.len(), 16); // Hex string representation
    }

    #[test]
    fn test_zero_trace_id() {
        use opentelemetry::trace::TraceId;

        let zero_trace_bytes = [0u8; super::TRACE_ID_BYTES_COUNT];
        let trace_id = TraceId::from_bytes(zero_trace_bytes);
        let trace_id_string = trace_id.to_string();

        assert_eq!(trace_id_string, "00000000000000000000000000000000");
    }

    #[test]
    fn test_zero_span_id() {
        use opentelemetry::trace::SpanId;

        let zero_span_bytes = [0u8; super::SPAN_ID_BYTES_COUNT];
        let span_id = SpanId::from_bytes(zero_span_bytes);
        let span_id_string = span_id.to_string();

        assert_eq!(span_id_string, "0000000000000000");
    }

    // Test span reference creation logic
    #[test]
    fn test_span_reference_creation() {
        use std::collections::HashMap;

        use opentelemetry::trace::{SpanId, TraceId};

        use crate::common::meta::traces::SpanRefType;

        let trace_bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let span_bytes = [1, 2, 3, 4, 5, 6, 7, 8];

        let trace_id = TraceId::from_bytes(trace_bytes).to_string();
        let parent_span_id = SpanId::from_bytes(span_bytes).to_string();

        let mut span_ref = HashMap::new();
        span_ref.insert(super::PARENT_TRACE_ID.to_string(), trace_id.clone());
        span_ref.insert(super::PARENT_SPAN_ID.to_string(), parent_span_id.clone());
        span_ref.insert(
            super::REF_TYPE.to_string(),
            format!("{:?}", SpanRefType::ChildOf),
        );

        assert_eq!(span_ref.get(super::PARENT_TRACE_ID).unwrap(), &trace_id);
        assert_eq!(
            span_ref.get(super::PARENT_SPAN_ID).unwrap(),
            &parent_span_id
        );
        assert_eq!(span_ref.get(super::REF_TYPE).unwrap(), "ChildOf");
        assert_eq!(span_ref.len(), 3);
    }

    #[test]
    fn test_empty_parent_span_reference() {
        use std::collections::HashMap;

        let mut span_ref = HashMap::new();
        let empty_parent_span_id: Vec<u8> = vec![];

        // Test logic for when parent_span_id is empty (no reference should be created)
        if !empty_parent_span_id.is_empty()
            && empty_parent_span_id.len() == super::SPAN_ID_BYTES_COUNT
        {
            // This should not execute for empty span ID
            span_ref.insert("should_not_exist".to_string(), "value".to_string());
        }

        assert!(span_ref.is_empty());
    }

    // Test attribute processing edge cases
    #[test]
    fn test_attribute_key_conflicts() {
        use std::collections::HashMap;

        use config::utils::json;

        // Test handling of keys that conflict with block fields
        let mut span_att_map: HashMap<String, json::Value> = HashMap::new();

        let test_keys = vec![
            "_timestamp",
            "duration",
            "start_time",
            "end_time",
            "normal_key",
        ];

        for key in test_keys {
            let processed_key = if super::BLOCK_FIELDS.contains(&key) {
                format!("attr_{key}")
            } else {
                key.to_string()
            };
            span_att_map.insert(processed_key, json::Value::String("test_value".to_string()));
        }

        assert!(span_att_map.contains_key("attr__timestamp"));
        assert!(span_att_map.contains_key("attr_duration"));
        assert!(span_att_map.contains_key("attr_start_time"));
        assert!(span_att_map.contains_key("attr_end_time"));
        assert!(span_att_map.contains_key("normal_key"));
        assert_eq!(span_att_map.len(), 5);
    }

    #[test]
    fn test_service_name_extraction() {
        use std::collections::HashMap;

        use config::utils::json;

        let mut service_att_map: HashMap<String, json::Value> = HashMap::new();

        // Test service.name attribute handling
        let service_name_key = super::SERVICE_NAME;
        let service_name_value = json::Value::String("test-service".to_string());

        if service_name_key == super::SERVICE_NAME {
            service_att_map.insert(super::SERVICE_NAME.to_string(), service_name_value.clone());
        } else {
            service_att_map.insert(
                format!("{}_{}", super::SERVICE, "other_attr"),
                service_name_value,
            );
        }

        assert!(service_att_map.contains_key(super::SERVICE_NAME));
        assert_eq!(
            service_att_map.get(super::SERVICE_NAME).unwrap(),
            "test-service"
        );
    }

    #[test]
    fn test_non_service_name_attribute() {
        use std::collections::HashMap;

        use config::utils::json;

        let mut service_att_map: HashMap<String, json::Value> = HashMap::new();
        let attr_key = "version";
        let attr_value = json::Value::String("1.0.0".to_string());

        // Test non-service.name attribute (should get service_ prefix)
        if attr_key != super::SERVICE_NAME {
            service_att_map.insert(
                format!("{}_{}", super::SERVICE, attr_key),
                attr_value.clone(),
            );
        }

        assert!(service_att_map.contains_key("service_version"));
        assert_eq!(service_att_map.get("service_version").unwrap(), "1.0.0");
    }

    // Test time validation boundary conditions
    #[test]
    fn test_timestamp_boundary_validation() {
        use chrono::{Duration, Utc};

        let now = Utc::now();
        let hours_back = 24;
        let hours_forward = 1;

        let min_ts = (now - Duration::try_hours(hours_back).unwrap()).timestamp_micros();
        let max_ts = (now + Duration::try_hours(hours_forward).unwrap()).timestamp_micros();
        let current_ts = now.timestamp_micros();

        // Test current timestamp (should be valid)
        assert!(current_ts >= min_ts);
        assert!(current_ts <= max_ts);

        // Test timestamp exactly at boundaries
        assert!(min_ts < max_ts);
    }

    #[test]
    fn test_nanosecond_to_microsecond_conversion() {
        let nano_timestamp = 1_640_995_200_123_456_789u64; // nanoseconds
        let micro_timestamp = (nano_timestamp / 1000) as i64; // convert to microseconds

        assert_eq!(micro_timestamp, 1_640_995_200_123_456);

        // Test edge case: exactly divisible by 1000
        let exact_nano = 1_000_000_000u64;
        let exact_micro = (exact_nano / 1000) as i64;
        assert_eq!(exact_micro, 1_000_000);
    }

    #[test]
    fn test_span_duration_edge_cases() {
        // Test same start and end time (zero duration)
        let start_time = 1_640_995_200_000_000_000u64;
        let end_time = start_time;
        let duration = (end_time - start_time) / 1000;
        assert_eq!(duration, 0);

        // Test very small duration (1 nanosecond)
        let end_time_small = start_time + 1;
        let duration_small = (end_time_small - start_time) / 1000;
        assert_eq!(duration_small, 0); // Less than 1 microsecond rounds to 0

        // Test 1 microsecond duration
        let end_time_micro = start_time + 1000;
        let duration_micro = (end_time_micro - start_time) / 1000;
        assert_eq!(duration_micro, 1);
    }

    // Test span status extraction with attributes
    #[test]
    fn test_status_attribute_extraction() {
        use std::collections::HashMap;

        use config::utils::json;
        use opentelemetry_proto::tonic::trace::v1::{Status, status::StatusCode};

        let mut span_att_map: HashMap<String, json::Value> = HashMap::new();
        let status = Status {
            code: StatusCode::Error as i32,
            message: "Internal server error".to_string(),
        };

        // Simulate the status attribute extraction logic
        span_att_map.insert(super::ATTR_STATUS_CODE.into(), status.code.into());
        span_att_map.insert(
            super::ATTR_STATUS_MESSAGE.into(),
            status.message.clone().into(),
        );

        assert_eq!(
            span_att_map.get(super::ATTR_STATUS_CODE).unwrap(),
            &(StatusCode::Error as i32)
        );
        assert_eq!(
            span_att_map.get(super::ATTR_STATUS_MESSAGE).unwrap(),
            "Internal server error"
        );
    }
}
