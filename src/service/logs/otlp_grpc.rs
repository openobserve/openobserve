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

use std::collections::{HashMap, HashSet};

use actix_web::{http, web, HttpResponse};
use anyhow::Result;
use bytes::BytesMut;
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::{stream::StreamType, usage::UsageType},
    metrics,
    utils::{flatten, json},
};
use infra::schema::SchemaCache;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsPartialSuccess, ExportLogsServiceRequest, ExportLogsServiceResponse,
};
use prost::Message;

use super::ingest::handle_timestamp;
use crate::{
    common::meta::{
        alerts::Alert,
        http::HttpResponse as MetaHttpResponse,
        ingestion::{IngestionResponse, StreamStatus},
        stream::StreamParams,
    },
    handler::http::request::CONTENT_TYPE_PROTO,
    service::{
        db, get_formatted_stream_name,
        ingestion::grpc::{get_val, get_val_with_type_retained},
        schema::{get_upto_discard_error, stream_schema_exists},
        usage::report_request_usage_stats,
    },
};

pub async fn usage_ingest(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();

    // check stream
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let stream_name = &get_formatted_stream_name(
        &mut StreamParams::new(org_id, in_stream_name, StreamType::Logs),
        &mut stream_schema_map,
    )
    .await;
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    if !db::file_list::BLOCKED_ORGS.is_empty()
        && db::file_list::BLOCKED_ORGS.contains(&org_id.to_string())
    {
        return Err(anyhow::anyhow!(
            "Quota exceeded for this organization [{}]",
            org_id
        ));
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, StreamType::Logs, stream_name, None) {
        return Err(anyhow::anyhow!("stream [{stream_name}] is being deleted"));
    }

    let cfg = config::get_config();
    let min_ts = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    crate::service::ingestion::get_stream_alerts(
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: stream_name.to_owned().into(),
            stream_type: StreamType::Logs,
        }],
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    let mut stream_status = StreamStatus::new(stream_name);
    let mut json_data = Vec::new();
    let reader: Vec<json::Value> = json::from_slice(&body)?;
    for item in reader.into_iter() {
        // JSON Flattening
        let mut value = flatten::flatten_with_level(item, cfg.limit.ingest_flatten_level)?;

        // get json object
        let mut local_val = match value.take() {
            json::Value::Object(v) => v,
            _ => {
                stream_status.status.failed += 1; // transform failed or dropped
                continue;
            }
        };

        // handle timestamp
        let timestamp = match handle_timestamp(&mut local_val, min_ts) {
            Ok(ts) => ts,
            Err(e) => {
                stream_status.status.failed += 1;
                stream_status.status.error = e.to_string();
                continue;
            }
        };

        json_data.push((timestamp, local_val));
    }

    // QUESTION(taiming): return directly when no data?
    // if no data, fast return
    if json_data.is_empty() {
        return Ok(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ));
    }

    let _ = match super::write_logs(
        &super::StreamMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            stream_alerts_map: &stream_alerts_map,
        },
        &mut stream_schema_map,
        &mut stream_status.status,
        json_data,
    )
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            log::error!("Error while writing logs: {}", e);
            // QUESTION(taiming): return directly when error?
            return Ok(IngestionResponse::new(
                http::StatusCode::OK.into(),
                vec![stream_status],
            ));
        }
    };

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    // drop variables
    drop(stream_schema_map);
    drop(stream_alerts_map);

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    ))
}

pub async fn handle_grpc_request(
    org_id: &str,
    request: ExportLogsServiceRequest,
    is_grpc: bool,
    in_stream_name: Option<&str>,
    user_email: &str,
) -> Result<HttpResponse> {
    let started_at = Utc::now().timestamp_micros();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty()
        && db::file_list::BLOCKED_ORGS.contains(&org_id.to_string())
    {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            format!("Quota exceeded for this organization [{}]", org_id),
        )));
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Ok(
            HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                http::StatusCode::SERVICE_UNAVAILABLE.into(),
                e.to_string(),
            )),
        );
    }

    let start = std::time::Instant::now();

    // check stream
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let stream_name = match in_stream_name {
        Some(name) => {
            get_formatted_stream_name(
                &mut StreamParams::new(org_id, name, StreamType::Logs),
                &mut stream_schema_map,
            )
            .await
        }
        None => {
            let _schema_exists =
                stream_schema_exists(org_id, "default", StreamType::Logs, &mut stream_schema_map)
                    .await;
            "default".to_owned()
        }
    };

    let stream_name = &stream_name;
    let cfg = config::get_config();

    // Start Register Transforms for stream
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let stream_param = StreamParams {
        org_id: org_id.to_owned().into(),
        stream_name: stream_name.to_owned().into(),
        stream_type: StreamType::Logs,
    };

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    crate::service::ingestion::get_stream_alerts(&[stream_param.clone()], &mut stream_alerts_map)
        .await;
    // End get stream alert

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, HashSet<String>> = HashMap::new();
    crate::service::ingestion::get_user_defined_schema(
        &[stream_param],
        &mut user_defined_schema_map,
    )
    .await;
    // End get user defined schema

    let mut stream_status = StreamStatus::new(stream_name);
    let mut json_data = Vec::new(); // TODO(taiming): get size and use capacity

    for resource_log in &request.resource_logs {
        for instrumentation_logs in &resource_log.scope_logs {
            for log_record in &instrumentation_logs.log_records {
                let mut rec = json::json!({});

                match &resource_log.resource {
                    Some(res) => {
                        for item in &res.attributes {
                            rec[item.key.as_str()] =
                                get_val_with_type_retained(&item.value.as_ref());
                        }
                    }
                    None => {}
                }
                match &instrumentation_logs.scope {
                    Some(lib) => {
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
                    None => {}
                }

                // check ingestion time
                let earlest_time =
                    Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap();

                let ts = if log_record.time_unix_nano != 0 {
                    log_record.time_unix_nano / 1000
                } else {
                    log_record.observed_time_unix_nano / 1000
                };

                if ts < earlest_time.timestamp_micros().try_into().unwrap() {
                    stream_status.status.failed += 1; // to old data, just discard
                    stream_status.status.error = get_upto_discard_error().to_string();
                    continue;
                }

                rec[cfg.common.column_timestamp.clone()] = ts.into();
                rec["severity"] = if !log_record.severity_text.is_empty() {
                    log_record.severity_text.to_owned().into()
                } else {
                    log_record.severity_number.into()
                };
                // rec["name"] = log_record.name.to_owned().into();
                rec["body"] = get_val(&log_record.body.as_ref());
                for item in &log_record.attributes {
                    rec[item.key.as_str()] = get_val_with_type_retained(&item.value.as_ref());
                }
                rec["dropped_attributes_count"] = log_record.dropped_attributes_count.into();
                match TraceId::from_bytes(
                    log_record
                        .trace_id
                        .as_slice()
                        .try_into()
                        .unwrap_or_default(),
                ) {
                    TraceId::INVALID => {}
                    _ => {
                        rec["trace_id"] =
                            TraceId::from_bytes(log_record.trace_id.as_slice().try_into().unwrap())
                                .to_string()
                                .into();
                    }
                };

                match SpanId::from_bytes(
                    log_record.span_id.as_slice().try_into().unwrap_or_default(),
                ) {
                    SpanId::INVALID => {}
                    _ => {
                        rec["span_id"] =
                            SpanId::from_bytes(log_record.span_id.as_slice().try_into().unwrap())
                                .to_string()
                                .into();
                    }
                };

                // flattening
                rec = flatten::flatten_with_level(rec, cfg.limit.ingest_flatten_level)?;

                if !local_trans.is_empty() {
                    rec = crate::service::ingestion::apply_stream_functions(
                        &local_trans,
                        rec,
                        &stream_vrl_map,
                        org_id,
                        stream_name,
                        &mut runtime,
                    )?;
                }

                // get json object
                let mut local_val = match rec.take() {
                    json::Value::Object(v) => v,
                    _ => unreachable!(),
                };

                if let Some(fields) = user_defined_schema_map.get(stream_name) {
                    local_val = crate::service::logs::refactor_map(local_val, fields);
                }

                json_data.push((ts as i64, local_val));
            }
        }
    }

    let mut res = ExportLogsServiceResponse {
        partial_success: None,
    };

    // QUESTION(taiming): return directly when no data?
    // if no data, fast return
    if json_data.is_empty() {
        let mut out = BytesMut::with_capacity(res.encoded_len());
        res.encode(&mut out).expect("Out of memory");
        return Ok(HttpResponse::Ok()
            .status(http::StatusCode::OK)
            .content_type(CONTENT_TYPE_PROTO)
            .body(out)); // just return
    }

    let mut req_stats = match super::write_logs(
        &super::StreamMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            stream_alerts_map: &stream_alerts_map,
        },
        &mut stream_schema_map,
        &mut stream_status.status,
        json_data,
    )
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            log::error!("Error while writing logs: {}", e);
            res.partial_success = Some(ExportLogsPartialSuccess {
                rejected_log_records: stream_status.status.failed as i64,
                error_message: stream_status.status.error,
            });
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            return Ok(HttpResponse::Ok()
                .status(http::StatusCode::OK)
                .content_type(CONTENT_TYPE_PROTO)
                .body(out)); // just return
        }
    };

    let ep = if is_grpc {
        "/grpc/export/logs"
    } else {
        "/api/org/v1/logs"
    };

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    req_stats.response_time = start.elapsed().as_secs_f64();
    req_stats.user_email = Some(user_email.to_string());
    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Json,
        0,
        started_at,
    )
    .await;

    // drop variables
    drop(runtime);
    drop(stream_schema_map);
    drop(stream_vrl_map);
    drop(stream_alerts_map);

    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type(CONTENT_TYPE_PROTO)
        .body(out));
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::{
        collector::logs::v1::ExportLogsServiceRequest,
        common::v1::{
            any_value::Value::{IntValue, StringValue},
            AnyValue, InstrumentationScope, KeyValue,
        },
        logs::v1::{LogRecord, ResourceLogs, ScopeLogs},
    };

    use crate::service::logs::otlp_grpc::handle_grpc_request;

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

        let result =
            handle_grpc_request(org_id, request, true, Some("test_stream"), "a@a.com").await;
        assert!(result.is_ok());
    }
}
