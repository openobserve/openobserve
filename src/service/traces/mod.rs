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

use actix_web::{http, HttpResponse};
use ahash::AHashMap;
use bytes::BytesMut;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::trace::v1::{ExportTraceServiceRequest, ExportTraceServiceResponse},
    trace::v1::{status::StatusCode, Status},
};
use prost::Message;
use std::{fs::OpenOptions, io::Error};

use crate::common::{
    infra::{
        cluster,
        config::{CONFIG, DISTINCT_FIELDS},
        metrics,
    },
    meta::{
        alert::{Alert, Evaluate, Trigger},
        http::HttpResponse as MetaHttpResponse,
        stream::{PartitionTimeLevel, StreamParams},
        traces::{Event, Span, SpanRefType},
        usage::UsageType,
        StreamType,
    },
    utils::{flatten, json},
};
use crate::service::{
    db, distinct_values, format_partition_key, format_stream_name,
    ingestion::{grpc::get_val, write_file},
    schema::{add_stream_schema, stream_schema_exists},
    stream::unwrap_partition_time_level,
    usage::report_request_usage_stats,
};

pub mod otlp_http;

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn handle_trace_request(
    org_id: &str,
    thread_id: usize,
    request: ExportTraceServiceRequest,
    is_grpc: bool,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, Error> {
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

    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_owned(),
    };

    let traces_stream_name = &traces_stream_name;

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut trace_meta_coll: AHashMap<String, Vec<json::Map<String, json::Value>>> =
        AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut traces_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let stream_schema = stream_schema_exists(
        org_id,
        traces_stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
    )
    .await;

    let mut partition_keys: Vec<String> = vec![];
    let mut partition_time_level =
        PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            traces_stream_name,
            &traces_schema_map,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Traces);
    }

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Traces,
        traces_stream_name,
    );
    // End Register Transforms for stream

    let mut trigger: Option<Trigger> = None;

    let mut data_buf: AHashMap<String, Vec<String>> = AHashMap::new();

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    let mut service_name: String = traces_stream_name.to_string();
    let res_spans = request.resource_spans;
    for res_span in res_spans {
        let mut service_att_map: AHashMap<String, json::Value> = AHashMap::new();
        let resource = res_span.resource.unwrap();

        for res_attr in resource.attributes {
            if res_attr.key.eq(SERVICE_NAME) {
                let loc_service_name = get_val(&res_attr.value.as_ref());
                if !loc_service_name.eq(&json::Value::Null) {
                    service_name = loc_service_name.as_str().unwrap().to_string();
                    service_att_map.insert(res_attr.key, loc_service_name);
                }
            } else {
                service_att_map.insert(
                    format!("{}.{}", SERVICE, res_attr.key),
                    get_val(&res_attr.value.as_ref()),
                );
            }
        }
        let inst_resources = res_span.scope_spans;
        for inst_span in inst_resources {
            let spans = inst_span.spans;
            for span in spans {
                let span_id: String = SpanId::from_bytes(
                    span.span_id
                        .as_slice()
                        .try_into()
                        .expect("slice with incorrect length"),
                )
                .to_string();
                let trace_id: String = TraceId::from_bytes(
                    span.trace_id
                        .as_slice()
                        .try_into()
                        .expect("slice with incorrect length"),
                )
                .to_string();
                let mut span_ref = AHashMap::new();
                if !span.parent_span_id.is_empty() {
                    span_ref.insert(PARENT_TRACE_ID.to_string(), trace_id.clone());
                    span_ref.insert(
                        PARENT_SPAN_ID.to_string(),
                        SpanId::from_bytes(
                            span.parent_span_id
                                .as_slice()
                                .try_into()
                                .expect("slice with incorrect length"),
                        )
                        .to_string(),
                    );
                    span_ref.insert(REF_TYPE.to_string(), format!("{:?}", SpanRefType::ChildOf));
                }
                let start_time: u64 = span.start_time_unix_nano;
                let end_time: u64 = span.end_time_unix_nano;
                let mut span_att_map: AHashMap<String, json::Value> = AHashMap::new();
                for span_att in span.attributes {
                    span_att_map.insert(span_att.key, get_val(&span_att.value.as_ref()));
                }

                let mut events = vec![];
                let mut event_att_map: AHashMap<String, json::Value> = AHashMap::new();
                for event in span.events {
                    for event_att in event.attributes {
                        event_att_map.insert(event_att.key, get_val(&event_att.value.as_ref()));
                    }
                    events.push(Event {
                        name: event.name,
                        _timestamp: event.time_unix_nano,
                        attributes: event_att_map.clone(),
                    })
                }

                let timestamp = start_time / 1000;

                let local_val = Span {
                    trace_id: trace_id.clone(),
                    span_id,
                    span_kind: span.kind.to_string(),
                    span_status: get_span_status(span.status),
                    operation_name: span.name.clone(),
                    start_time,
                    end_time,
                    duration: (end_time - start_time) / 1000, // microseconds
                    reference: span_ref,
                    service_name: service_name.clone(),
                    attributes: span_att_map,
                    service: service_att_map.clone(),
                    flags: 1, //TODO add appropriate value
                    //_timestamp: timestamp,
                    events: json::to_string(&events).unwrap(),
                };

                let value: json::Value = json::to_value(local_val).unwrap();

                //JSON Flattening
                let mut value = flatten::flatten(&value).unwrap();

                if !local_trans.is_empty() {
                    value = crate::service::ingestion::apply_stream_transform(
                        &local_trans,
                        &value,
                        &stream_vrl_map,
                        traces_stream_name,
                        &mut runtime,
                    )
                    .unwrap_or(value);
                }
                // End row based transform */
                // get json object
                let val_map = value.as_object_mut().unwrap();

                val_map.insert(
                    CONFIG.common.column_timestamp.clone(),
                    json::Value::Number(timestamp.into()),
                );

                // get distinct_value item
                for field in DISTINCT_FIELDS.iter() {
                    if let Some(val) = val_map.get(field) {
                        if !val.is_null() {
                            let (filter_name, filter_value) = if field == "operation_name" {
                                ("service_name".to_string(), service_name.clone())
                            } else {
                                ("".to_string(), "".to_string())
                            };
                            distinct_values.push(distinct_values::DvItem {
                                stream_type: StreamType::Traces,
                                stream_name: traces_stream_name.to_string(),
                                field_name: field.to_string(),
                                field_value: val.as_str().unwrap().to_string(),
                                filter_name,
                                filter_value,
                            });
                        }
                    }
                }

                let value_str = crate::common::utils::json::to_string(&val_map).unwrap();

                // get hour key
                let mut hour_key = super::ingestion::get_wal_time_key(
                    timestamp.try_into().unwrap(),
                    &partition_keys,
                    partition_time_level,
                    value.as_object().unwrap(),
                    None,
                );

                if !stream_alerts_map.is_empty() {
                    // Start check for alert trigger
                    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
                    if let Some(alerts) = stream_alerts_map.get(&key) {
                        for alert in alerts {
                            if alert.is_real_time {
                                let set_trigger =
                                    alert.condition.evaluate(value.as_object().unwrap().clone());
                                if set_trigger {
                                    trigger = Some(Trigger {
                                        timestamp: timestamp.try_into().unwrap(),
                                        is_valid: true,
                                        alert_name: alert.name.clone(),
                                        stream: traces_stream_name.to_string(),
                                        org: org_id.to_string(),
                                        stream_type: StreamType::Traces,
                                        last_sent_at: 0,
                                        count: 0,
                                        is_ingest_time: true,
                                        parent_alert_deleted: false,
                                    });
                                }
                            }
                        }
                    }
                    // End check for alert trigger
                }

                if partition_keys.is_empty() {
                    let partition_key = format!("service_name={}", service_name);
                    hour_key.push_str(&format!("/{}", format_partition_key(&partition_key)));
                }

                let hour_buf = data_buf.entry(hour_key.clone()).or_default();

                hour_buf.push(value_str);

                if timestamp < min_ts.try_into().unwrap() {
                    min_ts = timestamp as i64;
                }

                //Trace Metadata
                let mut trace_meta = json::Map::new();
                trace_meta.insert("trace_id".to_owned(), json::Value::String(trace_id.clone()));
                trace_meta.insert("_timestamp".to_owned(), start_time.into());

                let hour_meta_buf = trace_meta_coll.entry(hour_key.clone()).or_default();
                hour_meta_buf.push(trace_meta);
            }
        }
    }

    let mut traces_file_name = "".to_string();
    let mut req_stats = write_file(
        &data_buf,
        thread_id,
        &StreamParams::new(org_id, traces_stream_name, StreamType::Traces),
        &mut traces_file_name,
        None,
    )
    .await;
    let time = start.elapsed().as_secs_f64();
    req_stats.response_time = time;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    let ep = if is_grpc {
        "grpc/export/traces"
    } else {
        "http-proto/api/org/traces/"
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

    //metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        traces_stream_name,
        StreamType::Traces,
        UsageType::Traces,
        0,
    )
    .await;

    let schema_exists = stream_schema_exists(
        org_id,
        traces_stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
    )
    .await;
    if !schema_exists.has_fields && !traces_file_name.is_empty() {
        let file = OpenOptions::new()
            .read(true)
            .open(&traces_file_name)
            .unwrap();
        add_stream_schema(
            org_id,
            traces_stream_name,
            StreamType::Traces,
            &file,
            &mut traces_schema_map,
            min_ts,
        )
        .await;
    }

    // only one trigger per request, as it updates etcd
    if trigger.is_some() {
        let val = trigger.unwrap();
        let mut alerts = stream_alerts_map
            .get(&format!(
                "{}/{}/{}",
                val.org,
                StreamType::Traces,
                val.stream
            ))
            .unwrap()
            .clone();

        alerts.retain(|alert| alert.name.eq(&val.alert_name));
        if !alerts.is_empty() {
            crate::service::ingestion::send_ingest_notification(
                val,
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }

    let res = ExportTraceServiceResponse {
        partial_success: None,
    };
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type("application/x-protobuf")
        .body(out));
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
