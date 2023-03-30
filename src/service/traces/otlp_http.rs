// Copyright 2022 Zinc Labs Inc. and Contributors
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
use bytes::{BufMut, BytesMut};
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
#[cfg(feature = "zo_functions")]
use mlua::{Function, Lua};
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use prost::Message;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Error};
use tracing::info_span;

use crate::common::json::{Map, Value};
use crate::infra::config::CONFIG;
#[cfg(feature = "zo_functions")]
use crate::infra::config::STREAM_FUNCTIONS;
use crate::infra::file_lock;
use crate::meta::alert::{Alert, Trigger};
#[cfg(feature = "zo_functions")]
use crate::meta::functions::Transform;
use crate::meta::traces::Event;
use crate::service::schema::{add_stream_schema, stream_schema_exists};
use crate::{
    common::json,
    infra::cluster,
    meta::{
        self,
        traces::{Span, SpanRefType},
        StreamType,
    },
};

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn traces_proto(
    org_id: &str,
    thread_id: std::sync::Arc<usize>,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:otlp_http:traces_proto");
    let _guard = loc_span.enter();

    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");
    super::handle_trace_request(org_id, thread_id, request).await
}

pub async fn traces_json(
    org_id: &str,
    thread_id: std::sync::Arc<usize>,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:otlp_http:traces_json");
    let _guard = loc_span.enter();
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }
    let traces_stream_name = "default";

    let mut trace_meta_coll: AHashMap<String, Vec<json::Map<String, Value>>> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut traces_schema_map: AHashMap<String, Schema> = AHashMap::new();

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
    if stream_schema.has_partition_keys {
        partition_keys = crate::service::ingestion::get_stream_partition_keys(
            traces_stream_name.to_string(),
            traces_schema_map.clone(),
        )
        .await;
    }

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    #[cfg(feature = "zo_functions")]
    let lua = Lua::new();
    #[cfg(feature = "zo_functions")]
    let mut stream_lua_map: AHashMap<String, Function> = AHashMap::new();

    let mut trigger: Option<Trigger> = None;
    // Start Register Transfoms for stream
    #[cfg(feature = "zo_functions")]
    let mut local_tans: Vec<Transform> = vec![];
    #[cfg(feature = "zo_functions")]
    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
    #[cfg(feature = "zo_functions")]
    if let Some(transforms) = STREAM_FUNCTIONS.get(&key) {
        local_tans = (*transforms.list).to_vec();
        local_tans.sort_by(|a, b| a.order.cmp(&b.order));
        let mut func: Option<Function>;
        for trans in &local_tans {
            let func_key = format!("{}/{}", traces_stream_name, trans.name);
            func = crate::service::ingestion::load_lua_transform(&lua, trans.function.clone());
            if func.is_some() {
                stream_lua_map.insert(func_key, func.unwrap().to_owned());
            }
        }
    }
    // End Register Transfoms for stream

    let mut service_name: String = traces_stream_name.to_string();
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

        let traces: Value = json::from_slice(line.as_bytes()).unwrap();
        if traces.get("resourceSpans").is_some() {
            let res_spans = traces.get("resourceSpans").unwrap().as_array().unwrap();
            for res_span in res_spans {
                let mut service_att_map: AHashMap<String, Value> = AHashMap::new();
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
                                    service_att_map
                                        .insert(SERVICE_NAME.to_string(), item.1.clone());
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
                let inst_resources = if scope_resources.is_some() {
                    scope_resources.unwrap().as_array().unwrap()
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
                            let span_id: String =
                                span.get("spanId").unwrap().as_str().unwrap().to_string();
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
                                span_ref.insert(
                                    REF_TYPE.to_string(),
                                    format!("{:?}", SpanRefType::ChildOf),
                                );
                            }

                            let start_time: u64 =
                                span.get("startTimeUnixNano").unwrap().as_u64().unwrap();
                            let end_time: u64 =
                                span.get("endTimeUnixNano").unwrap().as_u64().unwrap();
                            let mut span_att_map: AHashMap<String, Value> = AHashMap::new();
                            let attributes = span.get("attributes").unwrap().as_array().unwrap();
                            for span_att in attributes {
                                span_att_map.insert(
                                    span_att.get("key").unwrap().as_str().unwrap().to_string(),
                                    get_val_for_attr(span_att.get("value").unwrap().clone()),
                                );
                            }

                            let mut events = vec![];
                            let mut event_att_map: AHashMap<String, Value> = AHashMap::new();

                            let span_events = span.get("events").unwrap().as_array().unwrap();
                            for event in span_events {
                                let attributes =
                                    event.get("attributes").unwrap().as_array().unwrap();
                                for event_att in attributes {
                                    event_att_map.insert(
                                        event_att.get("key").unwrap().as_str().unwrap().to_string(),
                                        get_val_for_attr(event_att.get("value").unwrap().clone()),
                                    );
                                }
                                events.push(Event {
                                    name: event.get("name").unwrap().as_str().unwrap().to_string(),
                                    _timestamp: event
                                        .get("timeUnixNano")
                                        .unwrap()
                                        .as_u64()
                                        .unwrap(),
                                    attributes: event_att_map.clone(),
                                })
                            }

                            let timestamp = start_time / 1000;
                            let local_val = Span {
                                trace_id: trace_id.clone(),
                                span_id,
                                span_kind: span.get("kind").unwrap().to_string(),
                                operation_name: span
                                    .get("name")
                                    .unwrap()
                                    .as_str()
                                    .unwrap()
                                    .to_string(),
                                start_time,
                                end_time,
                                duration: end_time - start_time,
                                reference: span_ref,
                                service_name: service_name.clone(),
                                attributes: span_att_map,
                                service: service_att_map.clone(),
                                flags: 1, //TODO add appropriate value
                                _timestamp: timestamp,
                                events: json::to_string(&events).unwrap(),
                            };
                            if timestamp < min_ts.try_into().unwrap() {
                                min_ts = timestamp as i64;
                            }

                            #[cfg(feature = "zo_functions")]
                            let mut value: json::Value = json::to_value(local_val).unwrap();
                            #[cfg(not(feature = "zo_functions"))]
                            let value: json::Value = json::to_value(local_val).unwrap();
                            #[cfg(feature = "zo_functions")]
                            // Start row based transform
                            for trans in &local_tans {
                                let func_key = format!("{traces_stream_name}/{}", trans.name);
                                if stream_lua_map.contains_key(&func_key) {
                                    value = crate::service::ingestion::lua_transform(
                                        &lua,
                                        &value,
                                        stream_lua_map.get(&func_key).unwrap(),
                                    );
                                }
                            }

                            let value_str = json::to_string(&value).unwrap();
                            // get hour key
                            let mut hour_key = crate::service::ingestion::get_hour_key(
                                timestamp.try_into().unwrap(),
                                partition_keys.clone(),
                                value.as_object().unwrap().clone(),
                            );

                            if !stream_alerts_map.is_empty() {
                                // Start check for alert trigger
                                let key = format!(
                                    "{}/{}/{}",
                                    &org_id,
                                    StreamType::Traces,
                                    traces_stream_name
                                );
                                if let Some(alerts) = stream_alerts_map.get(&key) {
                                    for alert in alerts {
                                        if alert.is_real_time {
                                            let set_trigger = meta::alert::Evaluate::evaluate(
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
                                                });
                                            }
                                        }
                                    }
                                }
                                // End check for alert trigger
                            }

                            hour_key.push_str(&format!("_service={}", service_name.clone()));

                            let hour_buf = data_buf.entry(hour_key.clone()).or_default();

                            hour_buf.push(value_str);
                            //Trace Metadata
                            let mut trace_meta = Map::new();
                            trace_meta.insert(
                                "trace_id".to_owned(),
                                json::Value::String(trace_id.clone()),
                            );
                            trace_meta.insert("_timestamp".to_owned(), start_time.into());

                            let hour_meta_buf =
                                trace_meta_coll.entry(hour_key.clone()).or_default();
                            hour_meta_buf.push(trace_meta);
                        }
                    }
                }
            }
        } else {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Bad Request".to_string(),
                )),
            );
        }
    }
    let mut write_buf = BytesMut::new();
    for (key, entry) in data_buf {
        if entry.is_empty() {
            continue;
        }

        write_buf.clear();
        for row in &entry {
            write_buf.put(row.as_bytes());
            write_buf.put("\n".as_bytes());
        }
        let file = file_lock::get_or_create(
            *thread_id.as_ref(),
            org_id,
            traces_stream_name,
            StreamType::Traces,
            &key,
            false,
        );
        let traces_file_name = file.full_name();

        file.write(write_buf.as_ref());

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
                val.clone(),
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }

    Ok(HttpResponse::Ok().json(meta::http::HttpResponse::message(
        http::StatusCode::OK.into(),
        "request processed".to_string(),
    )))

    //Ok(HttpResponse::Ok().into())
}

fn get_val_for_attr(attr_val: Value) -> Value {
    let local_val = attr_val.as_object().unwrap();
    if let Some((_key, value)) = local_val.into_iter().next() {
        return value.clone();
    };
    ().into()
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
        assert_eq!(resp.as_f64().unwrap(), in_val);
    }
}
