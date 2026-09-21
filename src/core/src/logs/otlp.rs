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

use std::collections::{HashMap, HashSet};

use axum::{
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::BytesMut;
use chrono::{Duration, Utc};
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::{
        otlp::OtlpRequestType,
        self_reporting::usage::UsageType,
        stream::{StreamParams, StreamType},
    },
    metrics,
    utils::{flatten, json, schema::format_stream_name},
};
use infra::{errors::Result, schema::get_flatten_level};
use ingestion_common::{IngestionStatus, StreamStatus};
use itertools::Itertools;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::logs::v1::{
        ExportLogsPartialSuccess, ExportLogsServiceRequest, ExportLogsServiceResponse,
    },
    common::v1::InstrumentationScope,
    logs::v1::LogRecord,
};
use prost::Message;
use schema::{get_future_discard_error, get_upto_discard_error};
use transform::TRANSFORM_FAILED;

use super::{bulk::TS_PARSE_FAILED, ingestion_log_enabled, log_failed_record};
use crate::{
    common::meta::http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, HttpResponse as MetaHttpResponse},
    db_monitoring::server_vantage::O2_EVENT_NAME,
    ingestion::{
        check_ingestion_allowed,
        grpc::{get_val, get_val_with_type_retained},
    },
};

/// The resource map with flatten's key spelling, or `None` when two wire keys would share a name.
fn normalized_resource_map(
    service_att_map: &json::Map<String, json::Value>,
) -> Option<json::Map<String, json::Value>> {
    let mut normalized = json::Map::with_capacity(service_att_map.len());
    for (key, value) in service_att_map {
        let key = flatten::format_label_name_cow(key).into_owned();
        if normalized.insert(key, value.clone()).is_some() {
            return None;
        }
    }
    Some(normalized)
}

/// One OTLP log record as a JSON object, keys normalized up front when that is provably exact.
fn otlp_log_record(
    service_att_map: &json::Map<String, json::Value>,
    normalized_resource: Option<&json::Map<String, json::Value>>,
    scope: Option<&InstrumentationScope>,
    log_record: &LogRecord,
    timestamp: i64,
) -> json::Value {
    if let Some(base) = normalized_resource
        && let Some(rec) = build_otlp_log_record(base, true, scope, log_record, timestamp)
    {
        return rec;
    }
    build_otlp_log_record(service_att_map, false, scope, log_record, timestamp)
        .expect("raw keys never collide")
}

/// `None` when a normalized attribute key lands on an existing entry: only the wire spelling
/// decides that.
fn build_otlp_log_record(
    base: &json::Map<String, json::Value>,
    normalize: bool,
    scope: Option<&InstrumentationScope>,
    log_record: &LogRecord,
    timestamp: i64,
) -> Option<json::Value> {
    let mut rec = json::Value::Object(base.clone());

    if let Some(lib) = scope {
        let library_name = lib.name.to_owned();
        if !library_name.is_empty() {
            rec["instrumentation_library_name"] = serde_json::Value::String(library_name);
        }
        let lib_version = lib.version.to_owned();
        if !lib_version.is_empty() {
            rec["instrumentation_library_version"] = serde_json::Value::String(lib_version);
        }
    }

    rec["severity"] = if !log_record.severity_text.is_empty() {
        log_record.severity_text.to_owned().into()
    } else {
        log_record.severity_number.into()
    };

    rec["body"] = get_val(&log_record.body.as_ref());
    rec["dropped_attributes_count"] = log_record.dropped_attributes_count.into();

    let rec_map = rec.as_object_mut().unwrap();
    for local_attr in &log_record.attributes {
        let key = if normalize {
            flatten::format_label_name_cow(&local_attr.key).into_owned()
        } else {
            local_attr.key.clone()
        };
        let value = get_val_with_type_retained(&local_attr.value.as_ref());
        if rec_map.insert(key, value).is_some() && normalize {
            return None;
        }
    }
    rec[TIMESTAMP_COL_NAME] = timestamp.into();
    Some(rec)
}

/// ProtoJSON rules: int64 as a decimal string, and `partial_success` omitted on a clean success.
fn export_response_to_proto_json(res: &ExportLogsServiceResponse) -> json::Value {
    match &res.partial_success {
        Some(ps) if ps.rejected_log_records != 0 || !ps.error_message.is_empty() => {
            let mut partial = json::Map::new();
            if ps.rejected_log_records != 0 {
                partial.insert(
                    "rejectedLogRecords".to_string(),
                    json::Value::String(ps.rejected_log_records.to_string()),
                );
            }
            if !ps.error_message.is_empty() {
                partial.insert(
                    "errorMessage".to_string(),
                    json::Value::String(ps.error_message.clone()),
                );
            }
            json::json!({ "partialSuccess": partial })
        }
        _ => json::json!({}),
    }
}

/// OTLP/HTTP requires the response body to use the encoding the request arrived in.
fn format_http_response(res: ExportLogsServiceResponse, req_type: OtlpRequestType) -> Response {
    match req_type {
        OtlpRequestType::HttpJson => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, CONTENT_TYPE_JSON)],
            json::to_vec(&export_response_to_proto_json(&res)).expect("serialize response"),
        )
            .into_response(),
        _ => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, CONTENT_TYPE_PROTO)],
                out.freeze(),
            )
                .into_response()
        }
    }
}

pub async fn handle_request(
    thread_id: usize,
    org_id: &str,
    request: ExportLogsServiceRequest,
    in_stream_name: Option<&str>,
    user_email: &str,
    req_type: OtlpRequestType,
) -> Result<Response> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    // check stream
    let stream_name = in_stream_name
        .map(|name| format_stream_name(name.to_string()))
        .unwrap_or_else(|| "default".to_string());
    check_ingestion_allowed(org_id, StreamType::Logs, Some(&stream_name)).await?;

    let cfg = get_config();
    let log_ingestion_errors = ingestion_log_enabled().await;

    let min_ts = (Utc::now() - Duration::hours(cfg.limit.ingest_allowed_upto)).timestamp_micros();
    let max_ts =
        (Utc::now() + Duration::hours(cfg.limit.ingest_allowed_in_future)).timestamp_micros();

    let index_all_max_value_length = cfg.limit.index_all_max_value_length;

    let stream_param = StreamParams::new(org_id, &stream_name, StreamType::Logs);
    // Start retrieve associated pipeline and construct pipeline components
    let executable_pipelines =
        crate::ingestion::get_stream_executable_pipelines(&stream_param).await;
    let mut stream_params = vec![stream_param];
    let mut pipeline_inputs = Vec::new();
    let mut original_options = Vec::new();
    // End pipeline params construction

    if !executable_pipelines.is_empty() {
        for pl in &executable_pipelines {
            let pl_destinations = pl.get_all_destination_streams();
            stream_params.extend(pl_destinations);
        }
    }

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    crate::ingestion::get_uds_and_original_data_streams(
        &stream_params,
        &mut user_defined_schema_map,
        &mut streams_need_original_map,
        &mut streams_need_all_values_map,
    )
    .await;

    // with pipeline, we need to store original if any of the destinations requires original
    // with a pipeline the destinations are unknown, so any destination wanting `_original` keeps it
    let need_original = if executable_pipelines.is_empty() {
        streams_need_original_map
            .get(&stream_name)
            .is_some_and(|v| *v)
    } else {
        streams_need_original_map.values().any(|val| *val)
    };
    let need_all_values = streams_need_all_values_map
        .get(&stream_name)
        .is_some_and(|v| *v);
    let uds_fields = user_defined_schema_map
        .get(&stream_name)
        .and_then(|fields| fields.as_ref());
    // only a plain write pre-normalizes keys: pipelines and `_original` see the wire spelling
    let normalize_keys = executable_pipelines.is_empty() && !need_original;
    let flatten_level = get_flatten_level(org_id, &stream_name, StreamType::Logs).await;
    let dbm_enabled = cfg.db_monitoring.enabled;
    // End get user defined schema

    let mut stream_status = StreamStatus::new(&stream_name);
    let mut json_data_by_stream = HashMap::new();
    let mut size_by_stream = HashMap::new();
    // the request writes one stream, so its records and size are collected without map probes
    let mut stream_records: Vec<(i64, json::Map<String, json::Value>)> = Vec::new();
    let mut stream_size = 0usize;
    let mut derived_streams = HashSet::new();
    let mut res = ExportLogsServiceResponse {
        partial_success: None,
    };
    for resource_log in request.resource_logs {
        if resource_log.scope_logs.is_empty() {
            continue;
        }

        let mut service_att_map: json::Map<String, json::Value> = json::Map::new();
        if let Some(resource) = resource_log.resource {
            for res_attr in resource.attributes {
                service_att_map.insert(
                    res_attr.key,
                    get_val_with_type_retained(&res_attr.value.as_ref()),
                );
            }
        }
        let normalized_resource = if normalize_keys {
            normalized_resource_map(&service_att_map)
        } else {
            None
        };

        for instrumentation_logs in &resource_log.scope_logs {
            for log_record in &instrumentation_logs.log_records {
                let timestamp = if log_record.time_unix_nano != 0 {
                    log_record.time_unix_nano as i64 / 1000
                } else {
                    log_record.observed_time_unix_nano as i64 / 1000
                };

                // check ingestion time
                if timestamp < min_ts || timestamp > max_ts {
                    stream_status.status.failed += 1; // to old data, just discard
                    stream_status.status.error = if timestamp < min_ts {
                        get_upto_discard_error()
                    } else {
                        get_future_discard_error()
                    }
                    .to_string();
                    metrics::INGEST_ERRORS
                        .with_label_values(&[
                            org_id,
                            StreamType::Logs.as_str(),
                            &stream_name,
                            TS_PARSE_FAILED,
                        ])
                        .inc();
                    log_failed_record(
                        log_ingestion_errors,
                        log_record,
                        &stream_status.status.error,
                    );
                    continue;
                }

                let mut rec = otlp_log_record(
                    &service_att_map,
                    normalized_resource.as_ref(),
                    instrumentation_logs.scope.as_ref(),
                    log_record,
                    timestamp,
                );

                match TraceId::from_bytes(
                    log_record
                        .trace_id
                        .as_slice()
                        .try_into()
                        .ok()
                        .unwrap_or_default(),
                ) {
                    TraceId::INVALID => {}
                    trace_id => {
                        rec["trace_id"] = trace_id.to_string().into();
                    }
                };

                match SpanId::from_bytes(
                    log_record.span_id.as_slice().try_into().unwrap_or_default(),
                ) {
                    SpanId::INVALID => {}
                    span_id => {
                        rec["span_id"] = span_id.to_string().into();
                    }
                };

                // store a copy of original data before it's modified, when
                // 1. original data is an object
                let original_data = (need_original && rec.is_object()).then(|| rec.to_string());

                // Surface the OTLP LogRecord `EventName` as `o2_event_name`.
                //
                // The DB-monitoring receivers (`postgresqlreceiver`/`mysqlreceiver`) put
                // the ONLY discriminator between `db.server.query_sample` and
                // `db.server.top_query` in this field — not in an attribute, and the Body
                // is unset — so without this the two events are indistinguishable
                // downstream.
                //
                // Placement, which is load-bearing three ways:
                //   * AFTER `log_record.attributes` are copied onto `rec`, so a caller attribute
                //     literally named `o2_event_name` is overwritten by the receiver's own value
                //     rather than trusted — the same protection, in the same slot, that
                //     `trace_id`/`span_id` get above.
                //   * AFTER the `original_data` snapshot, so `_original` stays a verbatim copy of
                //     what the customer sent and never gains a synthesized field.
                //   * BEFORE the flatten/branch below, so ONE write serves both the pipeline and
                //     non-pipeline branches.
                //
                // Gated on `db_monitoring.enabled` to match `apply_to_record`, which
                // early-returns when it is off: without the gate an operator who disabled
                // DBM would still get a DBM column written onto every receiver record.
                //
                // Only when non-empty, so records without an event name — every ordinary
                // log line in the product — are byte-identical to before.
                if !log_record.event_name.is_empty() && cfg.db_monitoring.enabled {
                    rec[O2_EVENT_NAME] = log_record.event_name.as_str().into();
                }

                if !executable_pipelines.is_empty() {
                    // buffer the records and originals for pipeline batch processing
                    pipeline_inputs.push(rec);
                    original_options.push(original_data);
                } else {
                    stream_size += json::estimate_json_bytes(&rec);
                    rec = flatten::flatten_with_level(rec, flatten_level)?;

                    // get json object
                    let mut local_val = match rec.take() {
                        json::Value::Object(v) => v,
                        _ => unreachable!(),
                    };

                    // DBM server-vantage canonicalization — the shipped collector recipes all
                    // export over OTLP, so this path is the one that matters for them.
                    if dbm_enabled {
                        crate::db_monitoring::server_vantage::canonicalize_dbm_record(
                            &mut local_val,
                        );
                    }

                    // Re-insert the trusted event name AFTER canonicalization.
                    //
                    // `o2_event_name` is a reserved field, so `apply_to_record`'s strip loop
                    // removes it along with every other caller-settable `o2_dbm_*` key. That
                    // strip has to be unconditional: it receives only a flattened map, in
                    // which a receiver-derived value and a forged one are byte-identical, so
                    // any attempt to keep "the trusted one" could only guess from the record
                    // shape — which is precisely what a spoofer controls. Restoring it here,
                    // where `log_record` is still in scope, is what makes the value trusted.
                    if !log_record.event_name.is_empty() && cfg.db_monitoring.enabled {
                        local_val.insert(
                            O2_EVENT_NAME.to_string(),
                            log_record.event_name.as_str().into(),
                        );
                    }

                    if let Some(fields) = uds_fields {
                        local_val = crate::ingestion::refactor_map(local_val, fields);
                    }

                    // add `_original` and '_record_id` if required by StreamSettings
                    if need_original && let Some(original_data) = original_data {
                        local_val.insert(ORIGINAL_DATA_COL_NAME.to_string(), original_data.into());

                        let record_id = crate::ingestion::generate_record_id(
                            org_id,
                            &stream_name,
                            &StreamType::Logs,
                        );

                        local_val.insert(ID_COL_NAME.to_string(), record_id.to_string().into());
                    }

                    // add `_all_values` if required by StreamSettings
                    if need_all_values {
                        let values = local_val
                            .iter()
                            .filter(|(k, v)| {
                                ![
                                    TIMESTAMP_COL_NAME,
                                    ID_COL_NAME,
                                    ORIGINAL_DATA_COL_NAME,
                                    ALL_VALUES_COL_NAME,
                                ]
                                .contains(&k.as_str())
                                    && (index_all_max_value_length == 0
                                        || v.as_str()
                                            .is_none_or(|s| s.len() <= index_all_max_value_length))
                            })
                            .map(|(_, v)| v)
                            .join(" ");
                        local_val
                            .insert(ALL_VALUES_COL_NAME.to_string(), json::Value::String(values));
                    }

                    stream_records.push((timestamp, local_val));
                }
            }
        }
    }

    if !stream_records.is_empty() {
        size_by_stream.insert(stream_name.clone(), stream_size);
        json_data_by_stream.insert(stream_name.clone(), (stream_records, Some(0)));
    }

    // batch process records through pipeline
    if !executable_pipelines.is_empty() {
        let records_count = pipeline_inputs.len();
        for exec_pl in &executable_pipelines {
            match exec_pl
                .process_batch(org_id, pipeline_inputs.clone(), Some(stream_name.clone()))
                .await
            {
                Err(e) => {
                    log::error!(
                        "[Pipeline] for stream {org_id}/{stream_name}: Batch execution error: {e}."
                    );
                    stream_status.status.failed += records_count as u32;
                    stream_status.status.error = format!("Pipeline batch execution error: {e}");
                    metrics::INGEST_ERRORS
                        .with_label_values(&[
                            org_id,
                            StreamType::Logs.as_str(),
                            &stream_name,
                            TRANSFORM_FAILED,
                        ])
                        .inc();
                }
                Ok(pl_results) => {
                    let function_no = exec_pl.num_of_func();
                    for (stream_params, stream_pl_results) in pl_results {
                        if stream_params.stream_type != StreamType::Logs {
                            continue;
                        }

                        let destination_stream = stream_params.stream_name.to_string();
                        if !derived_streams.contains(&destination_stream) {
                            derived_streams.insert(destination_stream.clone());
                        }

                        if !user_defined_schema_map.contains_key(&destination_stream) {
                            // a new dynamically created stream. need to check the two maps again
                            crate::ingestion::get_uds_and_original_data_streams(
                                &[stream_params],
                                &mut user_defined_schema_map,
                                &mut streams_need_original_map,
                                &mut streams_need_all_values_map,
                            )
                            .await;
                        }

                        for (idx, mut res) in stream_pl_results {
                            let timestamp =
                                match super::handle_timestamp_for_value(&mut res, min_ts, max_ts) {
                                    Ok(ts) => ts,
                                    Err(e) => {
                                        stream_status.status.failed += 1;
                                        stream_status.status.error = e.to_string();
                                        metrics::INGEST_ERRORS
                                            .with_label_values(&[
                                                org_id,
                                                StreamType::Logs.as_str(),
                                                &stream_name,
                                                TS_PARSE_FAILED,
                                            ])
                                            .inc();
                                        continue;
                                    }
                                };

                            let original_size = json::estimate_json_bytes(&res);
                            // get json object
                            let mut local_val = match res.take() {
                                json::Value::Object(v) => v,
                                _ => unreachable!(),
                            };

                            // Carry the trusted event name across the reservation strip.
                            //
                            // `local_val` here is VRL *output*, so the producer-loop value may
                            // or may not have survived the transform — but the INPUT record is
                            // still addressable: `idx` indexes `pipeline_inputs`, exactly as it
                            // indexes `original_options` a few lines below (`usize::MAX` is the
                            // "no source record" sentinel). Recovering it from there means a
                            // user pipeline on a DBM stream no longer silently reintroduces the
                            // very ambiguity W1 exists to remove.
                            let trusted_event_name = (idx != usize::MAX)
                                .then(|| {
                                    pipeline_inputs
                                        .get(idx)
                                        .and_then(|src| src.get(O2_EVENT_NAME))
                                        .cloned()
                                })
                                .flatten();

                            // Pipeline-routed records are canonicalized too: a VRL transform may
                            // have produced the receiver fields we dispatch on.
                            if dbm_enabled {
                                crate::db_monitoring::server_vantage::canonicalize_dbm_record(
                                    &mut local_val,
                                );
                            }

                            if let Some(event_name) = trusted_event_name {
                                local_val.insert(O2_EVENT_NAME.to_string(), event_name);
                            }

                            if let Some(Some(fields)) =
                                user_defined_schema_map.get(&destination_stream)
                            {
                                local_val = crate::ingestion::refactor_map(local_val, fields);
                            }

                            // add `_original` and '_record_id` if required by StreamSettings
                            if idx != usize::MAX
                                && streams_need_original_map
                                    .get(&destination_stream)
                                    .is_some_and(|v| *v)
                                && original_options[idx].is_some()
                            {
                                local_val.insert(
                                    ORIGINAL_DATA_COL_NAME.to_string(),
                                    original_options[idx].clone().unwrap().into(),
                                );

                                let record_id = crate::ingestion::generate_record_id(
                                    org_id,
                                    &destination_stream,
                                    &StreamType::Logs,
                                );
                                local_val
                                    .insert(ID_COL_NAME.to_string(), record_id.to_string().into());
                            }

                            // add `_all_values` if required by StreamSettings
                            if streams_need_all_values_map
                                .get(&destination_stream)
                                .copied()
                                .unwrap_or_default()
                            {
                                let values = local_val
                                    .iter()
                                    .filter(|(k, v)| {
                                        ![
                                            TIMESTAMP_COL_NAME,
                                            ID_COL_NAME,
                                            ORIGINAL_DATA_COL_NAME,
                                            ALL_VALUES_COL_NAME,
                                        ]
                                        .contains(&k.as_str())
                                            && (index_all_max_value_length == 0
                                                || v.as_str().is_none_or(|s| {
                                                    s.len() <= index_all_max_value_length
                                                }))
                                    })
                                    .map(|(_, v)| v)
                                    .join(" ");

                                local_val.insert(ALL_VALUES_COL_NAME.to_string(), values.into());
                            }

                            let size: &mut usize = size_by_stream
                                .entry(destination_stream.clone())
                                .or_insert(0);
                            *size += original_size;

                            let (ts_data, fn_num) = json_data_by_stream
                                .entry(destination_stream.clone())
                                .or_insert((Vec::new(), None));
                            ts_data.push((timestamp, local_val));
                            *fn_num = Some(function_no); // no pl -> no func
                        }
                    }
                }
            }
        } // for each pipeline

        // Evaluation-only pipelines emit no downstream records. Preserve the
        // original log stream while evaluator work runs asynchronously.
        let has_user_pipeline = executable_pipelines
            .iter()
            .any(|p| p.kind == config::meta::pipeline::PipelineKind::User);
        if !has_user_pipeline && !json_data_by_stream.contains_key(&stream_name) {
            for (idx, mut res) in pipeline_inputs.iter().cloned().enumerate() {
                let timestamp = match super::handle_timestamp_for_value(&mut res, min_ts, max_ts) {
                    Ok(ts) => ts,
                    Err(e) => {
                        stream_status.status.failed += 1;
                        stream_status.status.error = e.to_string();
                        metrics::INGEST_ERRORS
                            .with_label_values(&[
                                org_id,
                                StreamType::Logs.as_str(),
                                &stream_name,
                                TS_PARSE_FAILED,
                            ])
                            .inc();
                        continue;
                    }
                };

                let size: &mut usize = size_by_stream.entry(stream_name.clone()).or_insert(0);
                *size += json::estimate_json_bytes(&res);

                res = flatten::flatten_with_level(res, flatten_level)?;

                let mut local_val = match res.take() {
                    json::Value::Object(v) => v,
                    _ => unreachable!(),
                };

                // Carry the trusted event name across the reservation strip.
                //
                // These records are replayed `pipeline_inputs`, so they already hold the
                // value the producer loop wrote — `log_record` is out of scope here, but
                // it is not needed: the value travels on the record itself. Take it
                // before `apply_to_record` strips it and put it back after, exactly as
                // the non-pipeline branch does.
                let trusted_event_name = local_val.get(O2_EVENT_NAME).cloned();

                // DBM server-vantage canonicalization (see the note at the first call site).
                if dbm_enabled {
                    crate::db_monitoring::server_vantage::canonicalize_dbm_record(&mut local_val);
                }

                if let Some(event_name) = trusted_event_name {
                    local_val.insert(O2_EVENT_NAME.to_string(), event_name);
                }

                if let Some(Some(fields)) = user_defined_schema_map.get(&stream_name) {
                    local_val = crate::ingestion::refactor_map(local_val, fields);
                }

                if streams_need_original_map
                    .get(&stream_name)
                    .is_some_and(|v| *v)
                    && let Some(original_data) = original_options[idx].clone()
                {
                    local_val.insert(ORIGINAL_DATA_COL_NAME.to_string(), original_data.into());

                    let record_id = crate::ingestion::generate_record_id(
                        org_id,
                        &stream_name,
                        &StreamType::Logs,
                    );

                    local_val.insert(ID_COL_NAME.to_string(), record_id.to_string().into());
                }

                if streams_need_all_values_map
                    .get(&stream_name)
                    .copied()
                    .unwrap_or_default()
                {
                    let values = local_val
                        .iter()
                        .filter(|(k, v)| {
                            ![
                                TIMESTAMP_COL_NAME,
                                ID_COL_NAME,
                                ORIGINAL_DATA_COL_NAME,
                                ALL_VALUES_COL_NAME,
                            ]
                            .contains(&k.as_str())
                                && (index_all_max_value_length == 0
                                    || v.as_str()
                                        .is_none_or(|s| s.len() <= index_all_max_value_length))
                        })
                        .map(|(_, v)| v)
                        .join(" ");

                    local_val.insert(ALL_VALUES_COL_NAME.to_string(), values.into());
                }

                let (ts_data, fn_num) = json_data_by_stream
                    .entry(stream_name.clone())
                    .or_insert((Vec::new(), None));
                ts_data.push((timestamp, local_val));
                *fn_num = Some(0);
            }
        }
    }

    // drop variables
    drop(executable_pipelines);
    drop(original_options);
    drop(user_defined_schema_map);
    drop(streams_need_original_map);

    // Update partial success
    if stream_status.status.failed > 0 {
        res.partial_success = Some(ExportLogsPartialSuccess {
            rejected_log_records: stream_status.status.failed as i64,
            error_message: stream_status.status.error.clone(),
        });
    }

    let endpoint = match req_type {
        OtlpRequestType::Grpc => "/grpc/otlp/logs",
        _ => "/api/otlp/v1/logs",
    };

    // if no data, fast return
    if json_data_by_stream.is_empty() {
        return Ok(format_http_response(res, req_type)); // just return
    }

    // OTLP has no field for a deleting-stream skip, so a skipped stream still answers 200
    let write_result = super::write_logs_by_stream(
        thread_id,
        org_id,
        user_email,
        (started_at, &start),
        UsageType::Logs,
        &mut IngestionStatus::Record(stream_status.status),
        json_data_by_stream,
        size_by_stream,
        derived_streams,
        None,
    )
    .await;

    // metric + data usage
    let took_time = start.elapsed().as_secs_f64();
    let label_values = [
        endpoint,
        if write_result.is_ok() { "200" } else { "500" },
        org_id,
        StreamType::Logs.as_str(),
        "",
        "",
    ];
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&label_values)
        .observe(took_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&label_values)
        .inc();

    if let Err(e) = write_result {
        log::error!("Error while writing logs: {e}");
        return Ok(MetaHttpResponse::error_with_header(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("error while writing log data: {e}"),
        ));
    }

    Ok(format_http_response(res, req_type))
}

#[cfg(test)]
mod tests {
    use config::{
        meta::otlp::OtlpRequestType,
        utils::{flatten, json},
    };
    use opentelemetry_proto::tonic::{
        collector::logs::v1::{
            ExportLogsPartialSuccess, ExportLogsServiceRequest, ExportLogsServiceResponse,
        },
        common::v1::{
            AnyValue, InstrumentationScope, KeyValue,
            any_value::Value::{BoolValue, DoubleValue, IntValue, StringValue},
        },
        logs::v1::{LogRecord, ResourceLogs, ScopeLogs},
    };
    use prost::Message;

    use super::{
        CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, export_response_to_proto_json, format_http_response,
        normalized_resource_map, otlp_log_record,
    };

    fn partial_response(rejected: i64, error: &str) -> ExportLogsServiceResponse {
        ExportLogsServiceResponse {
            partial_success: Some(ExportLogsPartialSuccess {
                rejected_log_records: rejected,
                error_message: error.to_string(),
            }),
        }
    }

    async fn response_parts(
        res: ExportLogsServiceResponse,
        req_type: OtlpRequestType,
    ) -> (axum::http::StatusCode, String, Vec<u8>) {
        let response = format_http_response(res, req_type);
        let status = response.status();
        let content_type = response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .expect("content-type header")
            .to_str()
            .unwrap()
            .to_string();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec();
        (status, content_type, body)
    }

    fn kv(key: &str, value: opentelemetry_proto::tonic::common::v1::any_value::Value) -> KeyValue {
        KeyValue {
            key: key.to_string(),
            value: Some(AnyValue { value: Some(value) }),
            ..Default::default()
        }
    }

    fn kvlist(pairs: &[(&str, i64)]) -> opentelemetry_proto::tonic::common::v1::any_value::Value {
        use opentelemetry_proto::tonic::common::v1::{KeyValueList, any_value::Value};
        Value::KvlistValue(KeyValueList {
            values: pairs
                .iter()
                .map(|(k, v)| kv(k, Value::IntValue(*v)))
                .collect(),
        })
    }

    /// The pre-normalized build must flatten to exactly what the raw build flattens to.
    fn assert_normalized_build_matches_raw(
        resource: json::Map<String, json::Value>,
        attributes: Vec<KeyValue>,
    ) -> json::Map<String, json::Value> {
        let record = LogRecord {
            attributes,
            severity_text: "INFO".to_string(),
            ..Default::default()
        };
        let normalized = normalized_resource_map(&resource);
        let fast = otlp_log_record(&resource, normalized.as_ref(), None, &record, 1);
        let raw = otlp_log_record(&resource, None, None, &record, 1);
        let fast = flatten::flatten_with_level(fast, 0).unwrap();
        let raw = flatten::flatten_with_level(raw, 0).unwrap();
        assert_eq!(fast, raw);
        fast.as_object().unwrap().clone()
    }

    #[test]
    fn test_object_valued_attributes_colliding_after_normalization_keep_both() {
        use opentelemetry_proto::tonic::common::v1::any_value::Value;
        let rec = assert_normalized_build_matches_raw(
            json::Map::new(),
            vec![
                kv("a.b", kvlist(&[("x", 1)])),
                kv("a_b", kvlist(&[("y", 2)])),
                kv("plain", Value::StringValue("v".to_string())),
            ],
        );
        assert_eq!(rec["a_b_x"], json::json!(1));
        assert_eq!(rec["a_b_y"], json::json!(2));
    }

    #[test]
    fn test_scalar_collision_across_resource_and_record_keeps_flatten_precedence() {
        use opentelemetry_proto::tonic::common::v1::any_value::Value;
        let mut resource = json::Map::new();
        resource.insert("a.b".to_string(), json::json!(1));
        resource.insert("a_b".to_string(), json::json!(2));
        let rec =
            assert_normalized_build_matches_raw(resource, vec![kv("a.b", Value::IntValue(3))]);
        // flatten keeps the first key's position and the last key's value
        assert_eq!(rec["a_b"], json::json!(2));
    }

    #[test]
    fn test_collision_free_record_is_pre_normalized() {
        use opentelemetry_proto::tonic::common::v1::any_value::Value;
        let mut resource = json::Map::new();
        resource.insert("k8s.pod.name".to_string(), json::json!("p"));
        let normalized = normalized_resource_map(&resource).unwrap();
        let record = LogRecord {
            attributes: vec![kv("http.method", Value::StringValue("GET".to_string()))],
            ..Default::default()
        };
        let rec = otlp_log_record(&resource, Some(&normalized), None, &record, 1);
        let keys: Vec<&String> = rec.as_object().unwrap().keys().collect();
        assert!(keys.iter().all(|k| !k.contains('.')), "{keys:?}");
        assert!(
            normalized_resource_map(&{
                let mut r = json::Map::new();
                r.insert("a.b".to_string(), json::json!(1));
                r.insert("a_b".to_string(), json::json!(2));
                r
            })
            .is_none()
        );
    }

    use crate::logs::otlp::handle_request;

    #[tokio::test]
    async fn test_handle_logs_request() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            // name: "logA".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("This is a log message".to_string())),
            }),
            attributes: vec![
                KeyValue {
                    key: "app".to_string(),
                    value: Some(AnyValue {
                        value: Some(StringValue("server".to_string())),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "instance_num".to_string(),
                    value: Some(AnyValue {
                        value: Some(IntValue(1)),
                    }),
                    ..Default::default()
                },
            ],
            dropped_attributes_count: 1,
            trace_id: "".as_bytes().to_vec(),
            span_id: "".as_bytes().to_vec(),
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: Some(InstrumentationScope {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                attributes: vec![],
                dropped_attributes_count: 0,
            }),
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "a@a.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_resource_attributes() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Test log with resource".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            resource: Some(opentelemetry_proto::tonic::resource::v1::Resource {
                attributes: vec![
                    KeyValue {
                        key: "service.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(StringValue("test-service".to_string())),
                        }),
                        ..Default::default()
                    },
                    KeyValue {
                        key: "service.version".to_string(),
                        value: Some(AnyValue {
                            value: Some(StringValue("1.0.0".to_string())),
                        }),
                        ..Default::default()
                    },
                ],
                dropped_attributes_count: 0,
                entity_refs: vec![],
            }),
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::HttpJson,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_trace_and_span_ids() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 13,
            severity_text: "Error".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Error log with trace context".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![
                0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
                0x0e, 0x0f,
            ],
            span_id: vec![0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::HttpProtobuf,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_observed_time() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 0, // No time_unix_nano set
            observed_time_unix_nano: 1581452773000000789,
            severity_number: 5,
            severity_text: "Warning".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Log with observed time".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_multiple_records() {
        let org_id = "test_org_id";

        let log_recs = vec![
            LogRecord {
                time_unix_nano: 1581452773000000789,
                severity_number: 9,
                severity_text: "Info".to_string(),
                body: Some(AnyValue {
                    value: Some(StringValue("First log".to_string())),
                }),
                attributes: vec![],
                dropped_attributes_count: 0,
                trace_id: vec![],
                span_id: vec![],
                ..Default::default()
            },
            LogRecord {
                time_unix_nano: 1581452774000000789,
                severity_number: 5,
                severity_text: "Warning".to_string(),
                body: Some(AnyValue {
                    value: Some(StringValue("Second log".to_string())),
                }),
                attributes: vec![],
                dropped_attributes_count: 0,
                trace_id: vec![],
                span_id: vec![],
                ..Default::default()
            },
            LogRecord {
                time_unix_nano: 1581452775000000789,
                severity_number: 13,
                severity_text: "Error".to_string(),
                body: Some(AnyValue {
                    value: Some(StringValue("Third log".to_string())),
                }),
                attributes: vec![],
                dropped_attributes_count: 0,
                trace_id: vec![],
                span_id: vec![],
                ..Default::default()
            },
        ];

        let ins = ScopeLogs {
            scope: None,
            log_records: log_recs,
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_various_attribute_types() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Log with mixed attribute types".to_string())),
            }),
            attributes: vec![
                KeyValue {
                    key: "string_field".to_string(),
                    value: Some(AnyValue {
                        value: Some(StringValue("test_value".to_string())),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "int_field".to_string(),
                    value: Some(AnyValue {
                        value: Some(IntValue(42)),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "bool_field".to_string(),
                    value: Some(AnyValue {
                        value: Some(BoolValue(true)),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "double_field".to_string(),
                    value: Some(AnyValue {
                        value: Some(DoubleValue(1.23)),
                    }),
                    ..Default::default()
                },
            ],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::HttpJson,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_empty_request() {
        let org_id = "test_org_id";

        let request = ExportLogsServiceRequest {
            resource_logs: vec![],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_empty_scope_logs() {
        let org_id = "test_org_id";

        let res_logs = ResourceLogs {
            scope_logs: vec![],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_default_stream_name() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Log for default stream".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            None, // Should default to "default"
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_severity_number_only() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 13,           // ERROR level
            severity_text: "".to_string(), // Empty severity text
            body: Some(AnyValue {
                value: Some(StringValue("Log with severity number only".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_all_request_types() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Test log".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: None,
            log_records: vec![log_rec.clone()],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        // Test HttpJson
        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs.clone()],
        };
        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::HttpJson,
        )
        .await;
        assert!(result.is_ok());

        // Test HttpProtobuf
        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs.clone()],
        };
        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::HttpProtobuf,
        )
        .await;
        assert!(result.is_ok());

        // Test Grpc
        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };
        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_multiple_scope_logs() {
        let org_id = "test_org_id";

        let scope_logs1 = ScopeLogs {
            scope: Some(InstrumentationScope {
                name: "scope1".to_string(),
                version: "1.0.0".to_string(),
                attributes: vec![],
                dropped_attributes_count: 0,
            }),
            log_records: vec![LogRecord {
                time_unix_nano: 1581452773000000789,
                severity_number: 9,
                severity_text: "Info".to_string(),
                body: Some(AnyValue {
                    value: Some(StringValue("Log from scope1".to_string())),
                }),
                attributes: vec![],
                dropped_attributes_count: 0,
                trace_id: vec![],
                span_id: vec![],
                ..Default::default()
            }],
            ..Default::default()
        };

        let scope_logs2 = ScopeLogs {
            scope: Some(InstrumentationScope {
                name: "scope2".to_string(),
                version: "2.0.0".to_string(),
                attributes: vec![],
                dropped_attributes_count: 0,
            }),
            log_records: vec![LogRecord {
                time_unix_nano: 1581452774000000789,
                severity_number: 5,
                severity_text: "Warning".to_string(),
                body: Some(AnyValue {
                    value: Some(StringValue("Log from scope2".to_string())),
                }),
                attributes: vec![],
                dropped_attributes_count: 0,
                trace_id: vec![],
                span_id: vec![],
                ..Default::default()
            }],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![scope_logs1, scope_logs2],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_logs_with_instrumentation_library() {
        let org_id = "test_org_id";

        let log_rec = LogRecord {
            time_unix_nano: 1581452773000000789,
            severity_number: 9,
            severity_text: "Info".to_string(),
            body: Some(AnyValue {
                value: Some(StringValue("Log with instrumentation library".to_string())),
            }),
            attributes: vec![],
            dropped_attributes_count: 0,
            trace_id: vec![],
            span_id: vec![],
            ..Default::default()
        };

        let ins = ScopeLogs {
            scope: Some(InstrumentationScope {
                name: "my-library".to_string(),
                version: "1.2.3".to_string(),
                attributes: vec![],
                dropped_attributes_count: 0,
            }),
            log_records: vec![log_rec],
            ..Default::default()
        };

        let res_logs = ResourceLogs {
            scope_logs: vec![ins],
            ..Default::default()
        };

        let request = ExportLogsServiceRequest {
            resource_logs: vec![res_logs],
        };

        let result = handle_request(
            0,
            org_id,
            request,
            Some("test_stream"),
            "test@test.com",
            OtlpRequestType::Grpc,
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn json_request_gets_a_json_body_not_protobuf() {
        let (status, content_type, body) = response_parts(
            partial_response(1, "Too old data, only last 5 hours data can be ingested."),
            OtlpRequestType::HttpJson,
        )
        .await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(content_type, CONTENT_TYPE_JSON);
        let parsed: json::Value = json::from_slice(&body).expect("body must parse as JSON");
        assert_eq!(
            parsed["partialSuccess"]["rejectedLogRecords"],
            json::Value::String("1".into())
        );
        assert!(
            parsed["partialSuccess"]["errorMessage"]
                .as_str()
                .unwrap()
                .contains("Too old data")
        );
        assert_ne!(body.first(), Some(&0x0a), "must not be a protobuf payload");
    }

    #[tokio::test]
    async fn json_request_with_nothing_rejected_gets_an_empty_json_object() {
        let (_, content_type, body) = response_parts(
            ExportLogsServiceResponse {
                partial_success: None,
            },
            OtlpRequestType::HttpJson,
        )
        .await;

        assert_eq!(content_type, CONTENT_TYPE_JSON);
        assert_eq!(String::from_utf8(body).unwrap(), "{}");
    }

    #[tokio::test]
    async fn protobuf_request_still_gets_a_protobuf_body() {
        let (status, content_type, body) = response_parts(
            partial_response(1, "rejected"),
            OtlpRequestType::HttpProtobuf,
        )
        .await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(content_type, CONTENT_TYPE_PROTO);
        let decoded = ExportLogsServiceResponse::decode(body.as_slice()).expect("valid protobuf");
        assert_eq!(
            decoded.partial_success.unwrap().rejected_log_records,
            1,
            "protobuf clients must keep the payload they had before"
        );
    }

    #[tokio::test]
    async fn grpc_request_still_gets_a_protobuf_body() {
        let (_, content_type, body) =
            response_parts(partial_response(2, "rejected"), OtlpRequestType::Grpc).await;

        assert_eq!(content_type, CONTENT_TYPE_PROTO);
        let decoded = ExportLogsServiceResponse::decode(body.as_slice()).expect("valid protobuf");
        assert_eq!(decoded.partial_success.unwrap().rejected_log_records, 2);
    }

    #[test]
    fn proto_json_omits_partial_success_when_nothing_was_rejected() {
        let res = ExportLogsServiceResponse {
            partial_success: None,
        };
        assert_eq!(export_response_to_proto_json(&res), json::json!({}));

        let empty = partial_response(0, "");
        assert_eq!(export_response_to_proto_json(&empty), json::json!({}));
    }

    #[test]
    fn proto_json_encodes_the_reject_count_as_a_decimal_string() {
        let value = export_response_to_proto_json(&partial_response(7, "boom"));
        assert_eq!(
            value["partialSuccess"]["rejectedLogRecords"],
            json::Value::String("7".into()),
            "ProtoJSON encodes int64 as a string, not a number"
        );
        assert_eq!(
            value["partialSuccess"]["errorMessage"],
            json::Value::String("boom".into())
        );
    }
}
