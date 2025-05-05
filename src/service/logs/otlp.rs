// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, http};
use anyhow::Result;
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
    utils::{flatten, json},
};
use itertools::Itertools;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsPartialSuccess, ExportLogsServiceRequest, ExportLogsServiceResponse,
};
use prost::Message;

use super::{bulk::TS_PARSE_FAILED, ingestion_log_enabled, log_failed_record};
use crate::{
    common::meta::ingestion::{IngestionStatus, StreamStatus},
    handler::http::request::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
    service::{
        format_stream_name,
        ingestion::{
            SERVICE, SERVICE_NAME, check_ingestion_allowed,
            grpc::{get_val, get_val_with_type_retained},
        },
        logs::bulk::TRANSFORM_FAILED,
        schema::{get_future_discard_error, get_upto_discard_error},
    },
};

pub async fn handle_request(
    thread_id: usize,
    org_id: &str,
    request: ExportLogsServiceRequest,
    in_stream_name: Option<&str>,
    user_email: &str,
    req_type: OtlpRequestType,
) -> Result<HttpResponse> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    // check stream
    let stream_name = in_stream_name.map_or_else(|| "default".to_owned(), format_stream_name);
    check_ingestion_allowed(org_id, Some(&stream_name))?;

    let cfg = get_config();
    let log_ingestion_errors = ingestion_log_enabled().await;

    let min_ts = (Utc::now() - Duration::hours(cfg.limit.ingest_allowed_upto)).timestamp_micros();
    let max_ts =
        (Utc::now() + Duration::hours(cfg.limit.ingest_allowed_in_future)).timestamp_micros();

    let mut stream_params = vec![StreamParams::new(org_id, &stream_name, StreamType::Logs)];
    // Start retrieve associated pipeline and construct pipeline components
    let executable_pipeline = crate::service::ingestion::get_stream_executable_pipeline(
        org_id,
        &stream_name,
        &StreamType::Logs,
    )
    .await;
    let mut pipeline_inputs = Vec::new();
    let mut original_options = Vec::new();
    let mut timestamps = Vec::new();
    // End pipeline params construction

    if let Some(pl) = &executable_pipeline {
        let pl_destinations = pl.get_all_destination_streams();
        stream_params.extend(pl_destinations);
    }

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    crate::service::ingestion::get_uds_and_original_data_streams(
        &stream_params,
        &mut user_defined_schema_map,
        &mut streams_need_original_map,
        &mut streams_need_all_values_map,
    )
    .await;

    // with pipeline, we need to store original if any of the destinations requires original
    let store_original_when_pipeline_exists =
        executable_pipeline.is_some() && streams_need_original_map.values().any(|val| *val);
    // End get user defined schema

    let mut stream_status = StreamStatus::new(&stream_name);
    let mut json_data_by_stream = HashMap::new();

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
                if res_attr.key.eq(SERVICE_NAME) {
                    let loc_service_name = get_val(&res_attr.value.as_ref());
                    if loc_service_name.as_str().is_some() {
                        service_att_map.insert(SERVICE_NAME.to_string(), loc_service_name);
                    }
                } else {
                    service_att_map.insert(
                        format!("{}_{}", SERVICE, res_attr.key),
                        get_val_with_type_retained(&res_attr.value.as_ref()),
                    );
                }
            }
        }

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

                let mut rec = json::json!({});
                rec.as_object_mut().unwrap().extend(service_att_map.clone());

                if let Some(lib) = &instrumentation_logs.scope {
                    let library_name = lib.name.to_owned();
                    if !library_name.is_empty() {
                        rec["instrumentation_library_name"] =
                            serde_json::Value::String(library_name);
                    }
                    let lib_version = lib.version.to_owned();
                    if !lib_version.is_empty() {
                        rec["instrumentation_library_version"] =
                            serde_json::Value::String(lib_version);
                    }
                }

                rec[TIMESTAMP_COL_NAME.to_string()] = timestamp.into();
                rec["severity"] = if !log_record.severity_text.is_empty() {
                    log_record.severity_text.to_owned().into()
                } else {
                    log_record.severity_number.into()
                };

                rec["body"] = get_val(&log_record.body.as_ref());
                log_record.attributes.iter().for_each(|local_attr| {
                    let mut key = local_attr.key.clone();
                    flatten::format_key(&mut key);
                    rec[key] = get_val_with_type_retained(&local_attr.value.as_ref());
                });
                rec["dropped_attributes_count"] = log_record.dropped_attributes_count.into();

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
                let original_data = if rec.is_object() {
                    // 2. current stream does not have pipeline
                    if executable_pipeline.is_none() {
                        // current stream requires original
                        streams_need_original_map
                            .get(&stream_name)
                            .is_some_and(|v| *v)
                            .then_some(rec.to_string())
                    } else {
                        // 3. with pipeline, storing original as long as streams_need_original_set
                        //    is not empty
                        // because not sure the pipeline destinations
                        store_original_when_pipeline_exists.then_some(rec.to_string())
                    }
                } else {
                    None // `item` won't be flattened, no need to store original
                };

                if executable_pipeline.is_some() {
                    // buffer the records and originals for pipeline batch processing
                    pipeline_inputs.push(rec);
                    original_options.push(original_data);
                    timestamps.push(timestamp);
                } else {
                    // JSON Flattening
                    rec = flatten::flatten_with_level(rec, cfg.limit.ingest_flatten_level)?;

                    // get json object
                    let mut local_val = match rec.take() {
                        json::Value::Object(v) => v,
                        _ => unreachable!(),
                    };

                    if let Some(Some(fields)) = user_defined_schema_map.get(&stream_name) {
                        local_val = crate::service::logs::refactor_map(local_val, fields);
                    }

                    // add `_original` and '_record_id` if required by StreamSettings
                    if streams_need_original_map
                        .get(&stream_name)
                        .is_some_and(|v| *v)
                        && original_data.is_some()
                    {
                        local_val.insert(
                            ORIGINAL_DATA_COL_NAME.to_string(),
                            original_data.unwrap().into(),
                        );

                        let record_id = crate::service::ingestion::generate_record_id(
                            org_id,
                            &stream_name,
                            &StreamType::Logs,
                        );

                        local_val.insert(ID_COL_NAME.to_string(), record_id.to_string().into());
                    }

                    // add `_all_values` if required by StreamSettings
                    if streams_need_all_values_map
                        .get(&stream_name)
                        .is_some_and(|v| *v)
                    {
                        let values = local_val
                            .iter()
                            .filter(|(k, _)| {
                                ![
                                    TIMESTAMP_COL_NAME,
                                    ID_COL_NAME,
                                    ORIGINAL_DATA_COL_NAME,
                                    ALL_VALUES_COL_NAME,
                                ]
                                .contains(&k.as_str())
                            })
                            .map(|(_, v)| v)
                            .join(" ");
                        local_val
                            .insert(ALL_VALUES_COL_NAME.to_string(), json::Value::String(values));
                    }

                    let (ts_data, fn_num) = json_data_by_stream
                        .entry(stream_name.clone())
                        .or_insert((Vec::new(), None));
                    ts_data.push((timestamp, local_val));
                    *fn_num = Some(0); // no pl -> no func
                }
            }
        }
    }

    // batch process records through pipeline
    if let Some(exec_pl) = &executable_pipeline {
        let records_count = pipeline_inputs.len();
        match exec_pl
            .process_batch(org_id, pipeline_inputs, Some(stream_name.clone()))
            .await
        {
            Err(e) => {
                log::error!(
                    "[Pipeline] for stream {}/{}: Batch execution error: {}.",
                    org_id,
                    stream_name,
                    e
                );
                stream_status.status.failed += records_count as u32;
                stream_status.status.error = format!("Pipeline batch execution error: {}", e);
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
                    if !user_defined_schema_map.contains_key(&destination_stream) {
                        // a new dynamically created stream. need to check the two maps again
                        crate::service::ingestion::get_uds_and_original_data_streams(
                            &[stream_params],
                            &mut user_defined_schema_map,
                            &mut streams_need_original_map,
                            &mut streams_need_all_values_map,
                        )
                        .await;
                    }

                    for (idx, mut res) in stream_pl_results {
                        // get json object
                        let mut local_val = match res.take() {
                            json::Value::Object(v) => v,
                            _ => unreachable!(),
                        };

                        if let Some(Some(fields)) = user_defined_schema_map.get(&destination_stream)
                        {
                            local_val = crate::service::logs::refactor_map(local_val, fields);
                        }

                        // add `_original` and '_record_id` if required by StreamSettings
                        if streams_need_original_map
                            .get(&destination_stream)
                            .is_some_and(|v| *v)
                            && original_options[idx].is_some()
                        {
                            local_val.insert(
                                ORIGINAL_DATA_COL_NAME.to_string(),
                                original_options[idx].clone().unwrap().into(),
                            );

                            let record_id = crate::service::ingestion::generate_record_id(
                                org_id,
                                &destination_stream,
                                &StreamType::Logs,
                            );
                            local_val.insert(ID_COL_NAME.to_string(), record_id.to_string().into());
                        }

                        // add `_all_values` if required by StreamSettings
                        if streams_need_all_values_map
                            .get(&destination_stream)
                            .copied()
                            .unwrap_or_default()
                        {
                            let values = local_val
                                .iter()
                                .filter(|(k, _)| {
                                    ![
                                        TIMESTAMP_COL_NAME,
                                        ID_COL_NAME,
                                        ORIGINAL_DATA_COL_NAME,
                                        ALL_VALUES_COL_NAME,
                                    ]
                                    .contains(&k.as_str())
                                })
                                .map(|(_, v)| v)
                                .join(" ");

                            local_val.insert(ALL_VALUES_COL_NAME.to_string(), values.into());
                        }

                        let (ts_data, fn_num) = json_data_by_stream
                            .entry(destination_stream.clone())
                            .or_insert((Vec::new(), None));
                        ts_data.push((timestamps[idx], local_val));
                        *fn_num = Some(function_no); // no pl -> no func
                    }
                }
            }
        }
    }

    // drop variables
    drop(executable_pipeline);
    drop(original_options);
    drop(timestamps);
    drop(user_defined_schema_map);
    drop(streams_need_original_map);

    // Update partial success
    if stream_status.status.failed > 0 {
        res.partial_success = Some(ExportLogsPartialSuccess {
            rejected_log_records: stream_status.status.failed as i64,
            error_message: stream_status.status.error.clone(),
        });
    }

    let (content_type, endpoint) = match req_type {
        OtlpRequestType::HttpJson => (CONTENT_TYPE_JSON, "/api/otlp/v1/logs"),
        OtlpRequestType::HttpProtobuf => (CONTENT_TYPE_PROTO, "/api/otlp/v1/logs"),
        OtlpRequestType::Grpc => (CONTENT_TYPE_PROTO, "/grpc/otlp/logs"),
    };

    // if no data, fast return
    if json_data_by_stream.is_empty() {
        let mut out = BytesMut::with_capacity(res.encoded_len());
        res.encode(&mut out).expect("Out of memory");
        return Ok(HttpResponse::Ok()
            .status(http::StatusCode::OK)
            .content_type(content_type)
            .body(out)); // just return
    }

    let mut status = IngestionStatus::Record(stream_status.status);
    let (metric_rpt_status_code, response_body) = match super::write_logs_by_stream(
        thread_id,
        org_id,
        user_email,
        (started_at, &start),
        UsageType::Logs,
        &mut status,
        json_data_by_stream,
    )
    .await
    {
        Ok(()) => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            ("200", out)
        }
        Err(e) => {
            log::error!("Error while writing logs: {}", e);
            stream_status.status = match status {
                IngestionStatus::Record(status) => status,
                IngestionStatus::Bulk(_) => unreachable!(),
            };
            res.partial_success = Some(ExportLogsPartialSuccess {
                rejected_log_records: stream_status.status.failed as i64,
                error_message: stream_status.status.error,
            });
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            ("500", out)
        }
    };

    // metric + data usage
    let took_time = start.elapsed().as_secs_f64();
    let label_values = [
        endpoint,
        metric_rpt_status_code,
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

    Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type(content_type)
        .body(response_body))
}

#[cfg(test)]
mod tests {
    use config::meta::otlp::OtlpRequestType;
    use opentelemetry_proto::tonic::{
        collector::logs::v1::ExportLogsServiceRequest,
        common::v1::{
            AnyValue, InstrumentationScope, KeyValue,
            any_value::Value::{IntValue, StringValue},
        },
        logs::v1::{LogRecord, ResourceLogs, ScopeLogs},
    };

    use crate::service::logs::otlp::handle_request;

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
                },
                KeyValue {
                    key: "instance_num".to_string(),
                    value: Some(AnyValue {
                        value: Some(IntValue(1)),
                    }),
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
}
