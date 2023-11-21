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
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
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
    ingestion::{grpc::get_val_for_attr, write_file},
    schema::{add_stream_schema, stream_schema_exists},
    stream::unwrap_partition_time_level,
    usage::report_request_usage_stats,
};

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn traces_proto(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, Error> {
    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");
    super::handle_trace_request(org_id, thread_id, request, false, in_stream_name).await
}

pub async fn traces_json(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
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

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    let mut data_buf: AHashMap<String, Vec<String>> = AHashMap::new();

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

    let mut service_name: String = traces_stream_name.to_string();
    //let export_req: ExportTraceServiceRequest = json::from_slice(body.as_ref()).unwrap();
    let body: json::Value = match json::from_slice(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Invalid json: {}", e),
            )))
        }
    };
    let spans = match body.get("resourceSpans") {
        Some(v) => match v.as_array() {
            Some(v) => v,
            None => {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
                )))
            }
        },
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
            )))
        }
    };
    for res_span in spans.iter() {
        let mut service_att_map: AHashMap<String, json::Value> = AHashMap::new();
        if res_span.get("resource").is_some() {
            let resource = res_span.get("resource").unwrap().as_object().unwrap();
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
                            service_name = item.1.as_str().unwrap().to_string();
                            service_att_map.insert(SERVICE_NAME.to_string(), item.1.clone());
                        }
                    } else {
                        service_att_map.insert(
                            format!(
                                "{}.{}",
                                SERVICE,
                                local_attr.get("key").unwrap().as_str().unwrap()
                            ),
                            get_val_for_attr(local_attr.get("value").unwrap().clone()),
                        );
                    }
                }
            }
        }
        let scope_resources = res_span.get("scopeSpans");
        let inst_resources = if let Some(v) = scope_resources {
            v.as_array().unwrap()
        } else {
            res_span
                .get("instrumentationLibrarySpans")
                .unwrap()
                .as_array()
                .unwrap()
        };
        for inst_span in inst_resources {
            if inst_span.get("spans").is_some() {
                let spans = inst_span.get("spans").unwrap().as_array().unwrap();
                for span in spans {
                    let span_id: String = span.get("spanId").unwrap().as_str().unwrap().to_string();
                    let trace_id: String =
                        span.get("traceId").unwrap().as_str().unwrap().to_string();

                    let mut span_ref = AHashMap::new();
                    if span.get("parentSpanId").is_some() {
                        span_ref.insert(
                            PARENT_SPAN_ID.to_string(),
                            span.get("parentSpanId")
                                .unwrap()
                                .as_str()
                                .unwrap()
                                .to_string(),
                        );
                        span_ref.insert(PARENT_TRACE_ID.to_string(), trace_id.clone());
                        span_ref
                            .insert(REF_TYPE.to_string(), format!("{:?}", SpanRefType::ChildOf));
                    }

                    let start_time: u64 = span.get("startTimeUnixNano").unwrap().as_u64().unwrap();
                    let end_time: u64 = span.get("endTimeUnixNano").unwrap().as_u64().unwrap();
                    let mut span_att_map: AHashMap<String, json::Value> = AHashMap::new();
                    let attributes = span.get("attributes").unwrap().as_array().unwrap();
                    for span_att in attributes {
                        span_att_map.insert(
                            span_att.get("key").unwrap().as_str().unwrap().to_string(),
                            get_val_for_attr(span_att.get("value").unwrap().clone()),
                        );
                    }

                    let mut events = vec![];
                    let mut event_att_map: AHashMap<String, json::Value> = AHashMap::new();

                    let empty_vec = Vec::new();
                    let span_events = match span.get("events") {
                        Some(v) => v.as_array().unwrap(),
                        None => &empty_vec,
                    };
                    for event in span_events {
                        let attributes = event.get("attributes").unwrap().as_array().unwrap();
                        for event_att in attributes {
                            event_att_map.insert(
                                event_att.get("key").unwrap().as_str().unwrap().to_string(),
                                get_val_for_attr(event_att.get("value").unwrap().clone()),
                            );
                        }
                        events.push(Event {
                            name: event.get("name").unwrap().as_str().unwrap().to_string(),
                            _timestamp: event.get("timeUnixNano").unwrap().as_u64().unwrap(),
                            attributes: event_att_map.clone(),
                        })
                    }

                    let timestamp = start_time / 1000;
                    let local_val = Span {
                        trace_id: trace_id.clone(),
                        span_id,
                        span_kind: span.get("kind").unwrap().to_string(),
                        span_status: span
                            .get("status")
                            .unwrap_or(&json::Value::String("UNSET".to_string()))
                            .to_string(),
                        operation_name: span.get("name").unwrap().as_str().unwrap().to_string(),
                        start_time,
                        end_time,
                        duration: (end_time - start_time) / 1000, // microseconds
                        reference: span_ref,
                        service_name: service_name.clone(),
                        attributes: span_att_map,
                        service: service_att_map.clone(),
                        flags: 1, //TODO add appropriate value
                        events: json::to_string(&events).unwrap(),
                    };
                    if timestamp < min_ts.try_into().unwrap() {
                        min_ts = timestamp as i64;
                    }

                    let mut value: json::Value = json::to_value(local_val).unwrap();

                    //JSON Flattening
                    value = flatten::flatten(&value).unwrap();

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
                    let mut hour_key = crate::service::ingestion::get_wal_time_key(
                        timestamp.try_into().unwrap(),
                        &partition_keys,
                        partition_time_level,
                        value.as_object().unwrap(),
                        None,
                    );

                    if !stream_alerts_map.is_empty() {
                        // Start check for alert trigger
                        let key =
                            format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
                        if let Some(alerts) = stream_alerts_map.get(&key) {
                            for alert in alerts {
                                if alert.is_real_time {
                                    let set_trigger = Evaluate::evaluate(
                                        &alert.condition,
                                        value.as_object().unwrap().clone(),
                                    );
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
                    //Trace Metadata
                    let mut trace_meta = json::Map::new();
                    trace_meta.insert("trace_id".to_owned(), json::Value::String(trace_id.clone()));
                    trace_meta.insert("_timestamp".to_owned(), start_time.into());

                    let hour_meta_buf = trace_meta_coll.entry(hour_key.clone()).or_default();
                    hour_meta_buf.push(trace_meta);
                }
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

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "http-json/api/org/traces",
            "200",
            org_id,
            traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "http-json/api/org/traces",
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

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "request processed".to_string(),
    )))

    //Ok(HttpResponse::Ok().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use json::json;

    #[test]
    fn test_get_val_for_attr() {
        let in_val = 10.00;
        let input = json!({ "key": in_val });
        let resp = get_val_for_attr(input);
        assert_eq!(resp.as_str().unwrap(), in_val.to_string());
    }
}
