// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use arrow_schema::Schema;
use bytes::BytesMut;
use chrono::{Duration, Utc};
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsPartialSuccess, ExportLogsServiceRequest, ExportLogsServiceResponse,
};
use prost::Message;

use crate::common::{
    infra::{
        cluster,
        config::{CONFIG, DISTINCT_FIELDS},
        metrics,
    },
    meta::{
        alert::{Alert, Trigger},
        http::HttpResponse as MetaHttpResponse,
        ingestion::StreamStatus,
        stream::StreamParams,
        usage::UsageType,
        StreamType,
    },
    utils::{flatten, json},
};
use crate::handler::http::request::CONTENT_TYPE_JSON;
use crate::service::{
    db, distinct_values, get_formatted_stream_name,
    ingestion::{grpc::get_val_for_attr, write_file},
    schema::stream_schema_exists,
    usage::report_request_usage_stats,
};

use super::StreamMeta;

const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn logs_proto_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, std::io::Error> {
    let request = ExportLogsServiceRequest::decode(body).expect("Invalid protobuf");
    match super::otlp_grpc::handle_grpc_request(org_id, thread_id, request, false, in_stream_name)
        .await
    {
        Ok(res) => Ok(res),
        Err(e) => {
            log::error!("error while handling request: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            )
        }
    }
}

//example at: https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/#examples
pub async fn logs_json_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, std::io::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "Quota exceeded for this organization".to_string(),
        )));
    }

    let start = std::time::Instant::now();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
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
    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut distinct_values = Vec::with_capacity(16);
    let mut stream_status = StreamStatus::new(stream_name);
    let mut trigger: Option<Trigger> = None;

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let partition_det =
        crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map).await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();

    let body: json::Value = match json::from_slice(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Invalid json: {}", e),
            )))
        }
    };

    let logs = match body.get("resourceLogs") {
        Some(v) => match v.as_array() {
            Some(v) => v,
            None => {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid json: the structure must be {{\"resourceLogs\":[]}}".to_string(),
                )))
            }
        },
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Invalid json: the structure must be {{\"resourceLogs\":[]}}".to_string(),
            )))
        }
    };

    for res_log in logs.iter() {
        let mut service_att_map: json::Map<String, json::Value> = json::Map::new();
        if res_log.get("resource").is_some() {
            let resource = res_log.get("resource").unwrap().as_object().unwrap();
            if resource.get("attributes").is_some() {
                let attributes = resource.get("attributes").unwrap().as_array().unwrap();
                for res_attr in attributes {
                    let local_attr = res_attr.as_object().unwrap();
                    if local_attr
                        .get("key")
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .eq(SERVICE_NAME)
                    {
                        let loc_service_name =
                            local_attr.get("value").unwrap().as_object().unwrap();
                        for item in loc_service_name {
                            service_att_map.insert(SERVICE_NAME.to_string(), item.1.clone());
                        }
                    } else {
                        service_att_map.insert(
                            format!(
                                "{}_{}",
                                SERVICE,
                                local_attr.get("key").unwrap().as_str().unwrap()
                            ),
                            get_val_for_attr(local_attr.get("value").unwrap().clone()),
                        );
                    }
                }
            }
        }
        let scope_resources = res_log.get("scopeLogs");
        let inst_resources = if let Some(v) = scope_resources {
            v.as_array().unwrap()
        } else {
            res_log
                .get("instrumentationLibrarySpans")
                .unwrap()
                .as_array()
                .unwrap()
        };
        for inst_log in inst_resources {
            if inst_log.get("logRecords").is_some() {
                let log_records = inst_log.get("logRecords").unwrap().as_array().unwrap();
                for log in log_records {
                    let start_time: i64 = match log.get("timeUnixNano").unwrap() {
                        json::Value::Number(v) => v.as_u64().unwrap() as i64,
                        json::Value::String(v) => v.parse::<i64>().unwrap(),
                        _ => 0,
                    };

                    let timestamp = if start_time > 0 {
                        start_time / 1000
                    } else {
                        Utc::now().timestamp_micros()
                    };

                    let mut value: json::Value = json::to_value(log).unwrap();

                    //JSON Flattening
                    value = flatten::flatten(&value).unwrap();

                    // get json object
                    let mut local_val = value.as_object_mut().unwrap();

                    if log.get("attributes").is_some() {
                        let attributes = log.get("attributes").unwrap().as_array().unwrap();
                        for res_attr in attributes {
                            let local_attr = res_attr.as_object().unwrap();

                            local_val.insert(
                                local_attr.get("key").unwrap().as_str().unwrap().to_owned(),
                                get_val_for_attr(local_attr.get("value").unwrap().clone()),
                            );
                        }
                    }
                    //remove attributes after adding
                    local_val.remove("attributes");

                    //remove body before adding
                    local_val.remove("body_stringvalue");

                    if log.get("body").is_some() {
                        let body = log.get("body").unwrap().get("stringValue").unwrap();
                        local_val.insert("body".to_owned(), body.clone());
                    }

                    // check ingestion time
                    let earliest_time =
                        Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto);
                    if timestamp < earliest_time.timestamp_micros() {
                        stream_status.status.failed += 1; // to old data, just discard
                        stream_status.status.error = super::get_upto_discard_error();
                        continue;
                    }
                    if timestamp < min_ts {
                        min_ts = timestamp;
                    }

                    local_val.insert(
                        CONFIG.common.column_timestamp.clone(),
                        json::Value::Number(timestamp.into()),
                    );

                    local_val.append(&mut service_att_map.clone());

                    value = json::to_value(local_val).unwrap();
                    if !local_trans.is_empty() {
                        value = crate::service::ingestion::apply_stream_transform(
                            &local_trans,
                            &value,
                            &stream_vrl_map,
                            stream_name,
                            &mut runtime,
                        )
                        .unwrap_or(value);
                    }

                    local_val = value.as_object_mut().unwrap();

                    let local_trigger = super::add_valid_record(
                        &StreamMeta {
                            org_id: org_id.to_string(),
                            stream_name: stream_name.to_string(),
                            partition_keys: &partition_keys,
                            partition_time_level: &partition_time_level,
                            stream_alerts_map: &stream_alerts_map,
                        },
                        &mut stream_schema_map,
                        &mut stream_status.status,
                        &mut buf,
                        local_val,
                    )
                    .await;

                    if local_trigger.is_some() {
                        trigger = Some(local_trigger.unwrap());
                    }

                    // get distinct_value item
                    for field in DISTINCT_FIELDS.iter() {
                        if let Some(val) = local_val.get(field) {
                            if !val.is_null() {
                                distinct_values.push(distinct_values::DvItem {
                                    stream_type: StreamType::Logs,
                                    stream_name: stream_name.to_string(),
                                    field_name: field.to_string(),
                                    field_value: val.as_str().unwrap().to_string(),
                                    filter_name: "".to_string(),
                                    filter_value: "".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // write to file
    let mut stream_file_name = "".to_string();
    let mut req_stats = write_file(
        &buf,
        thread_id,
        &StreamParams::new(org_id, stream_name, StreamType::Logs),
        &mut stream_file_name,
        None,
    )
    .await;

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, &stream_alerts_map).await;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/v1/logs",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/v1/logs",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Json,
        0,
    )
    .await;

    let res = ExportLogsServiceResponse {
        partial_success: Some(ExportLogsPartialSuccess {
            rejected_log_records: stream_status.status.failed as i64,
            error_message: stream_status.status.error,
        }),
    };
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type(CONTENT_TYPE_JSON)
        .body(out));
}
