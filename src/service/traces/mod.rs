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
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::trace::v1::{ExportTraceServiceRequest, ExportTraceServiceResponse},
    common::v1::AnyValue,
};
use prost::Message;
use std::{fs::OpenOptions, io::Error};

use crate::common::{flatten, json};
use crate::infra::{cluster, config::CONFIG, wal};
use crate::meta::{
    alert::{Alert, Evaluate, Trigger},
    http::HttpResponse as MetaHttpResponse,
    traces::{Event, Span, SpanRefType},
    StreamType,
};
use crate::service::{
    db,
    ingestion::{format_stream_name, get_partition_key_record},
    schema::{add_stream_schema, stream_schema_exists},
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
            "Quota exceeded for this organisation".to_string(),
        )));
    }

    let traces_stream_name = "default";
    let mut trace_meta_coll: AHashMap<String, Vec<json::Map<String, json::Value>>> =
        AHashMap::new();
    let mut traces_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();

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
            traces_stream_name,
            &traces_schema_map,
        )
        .await;
    }

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

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
                let loc_service_name = get_val(res_attr.value);
                if !loc_service_name.eq(&json::Value::Null) {
                    service_name = loc_service_name.as_str().unwrap().to_string();
                    service_att_map.insert(res_attr.key, loc_service_name);
                }
            } else {
                service_att_map.insert(
                    format!("{}.{}", SERVICE, res_attr.key),
                    get_val(res_attr.value),
                );
            }
        }
        let inst_resources = res_span.instrumentation_library_spans;
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
                    span_att_map.insert(span_att.key, get_val(span_att.value));
                }

                let mut events = vec![];
                let mut event_att_map: AHashMap<String, json::Value> = AHashMap::new();
                for event in span.events {
                    for event_att in event.attributes {
                        event_att_map.insert(event_att.key, get_val(event_att.value));
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
                    operation_name: span.name.clone(),
                    start_time,
                    end_time,
                    duration: (end_time - start_time) / 1000000,
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

                // get json object
                let val_map = value.as_object_mut().unwrap();

                val_map.insert(
                    CONFIG.common.column_timestamp.clone(),
                    json::Value::Number(timestamp.into()),
                );

                let value_str = crate::common::json::to_string(&val_map).unwrap();

                // get hour key
                let mut hour_key = super::ingestion::get_hour_key(
                    timestamp.try_into().unwrap(),
                    partition_keys.clone(),
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
                                    });
                                }
                            }
                        }
                    }
                    // End check for alert trigger
                }

                if partition_keys.is_empty() {
                    let partition_key =
                        format!("service_name={}", format_stream_name(&service_name));
                    hour_key.push_str(&format!("_{}", get_partition_key_record(&partition_key)));
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
        let file = wal::get_or_create(
            thread_id,
            org_id,
            traces_stream_name,
            StreamType::Traces,
            &key,
            false,
        );
        let traces_file_name = file.full_name();

        file.write(write_buf.as_ref());

        if !stream_schema.has_fields && !traces_file_name.is_empty() {
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
            super::ingestion::send_ingest_notification(val, alerts.first().unwrap().clone()).await;
        }
    }
    let res = ExportTraceServiceResponse {};
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type("application/x-protobuf")
        .body(out));
}

fn get_val(attr_val: Option<AnyValue>) -> json::Value {
    match attr_val {
        Some(local_val) => match local_val.value {
            Some(val) => match val {
                opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(
                    inner_val,
                ) => json::json!(inner_val.as_str()),
                opentelemetry_proto::tonic::common::v1::any_value::Value::BoolValue(inner_val) => {
                    json::json!(inner_val.to_string())
                }
                opentelemetry_proto::tonic::common::v1::any_value::Value::IntValue(inner_val) => {
                    json::json!(inner_val.to_string())
                }
                opentelemetry_proto::tonic::common::v1::any_value::Value::DoubleValue(
                    inner_val,
                ) => json::json!(inner_val.to_string()),
                opentelemetry_proto::tonic::common::v1::any_value::Value::ArrayValue(inner_val) => {
                    let mut vals = vec![];
                    for item in inner_val.values.iter().cloned() {
                        vals.push(get_val(Some(item)))
                    }
                    json::json!(vals)
                }
                opentelemetry_proto::tonic::common::v1::any_value::Value::KvlistValue(
                    inner_val,
                ) => {
                    let mut vals = json::Map::new();
                    for item in inner_val.values.iter().cloned() {
                        vals.insert(item.key, get_val(item.value));
                    }
                    json::json!(vals)
                }
                opentelemetry_proto::tonic::common::v1::any_value::Value::BytesValue(inner_val) => {
                    json::json!(inner_val)
                }
            },
            None => json::Value::Null,
        },
        None => json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_val() {
        let in_str = "Test".to_string();
        let str_val = AnyValue {
            value: Some(
                opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(
                    in_str.clone(),
                ),
            ),
        };
        let resp = get_val(Some(str_val));
        assert_eq!(resp.as_str().unwrap(), in_str);

        let in_bool = false;
        let bool_val = AnyValue {
            value: Some(
                opentelemetry_proto::tonic::common::v1::any_value::Value::BoolValue(in_bool),
            ),
        };
        let resp = get_val(Some(bool_val));
        assert_eq!(resp.as_bool().unwrap(), in_bool);

        let in_int = 20;
        let int_val = AnyValue {
            value: Some(opentelemetry_proto::tonic::common::v1::any_value::Value::IntValue(in_int)),
        };
        let resp = get_val(Some(int_val.clone()));
        assert_eq!(resp.as_i64().unwrap(), in_int);

        let in_double = 20.00;
        let double_val = AnyValue {
            value: Some(
                opentelemetry_proto::tonic::common::v1::any_value::Value::DoubleValue(in_double),
            ),
        };
        let resp = get_val(Some(double_val));
        assert_eq!(resp.as_f64().unwrap(), in_double);

        let in_arr = vec![int_val.clone()];
        let arr_val = AnyValue {
            value: Some(
                opentelemetry_proto::tonic::common::v1::any_value::Value::ArrayValue {
                    0: opentelemetry_proto::tonic::common::v1::ArrayValue { values: in_arr },
                },
            ),
        };
        let resp = get_val(Some(arr_val));
        assert!(resp.as_array().unwrap().len() > 0);

        let kv_val = AnyValue {
            value: Some(
                opentelemetry_proto::tonic::common::v1::any_value::Value::KvlistValue {
                    0: opentelemetry_proto::tonic::common::v1::KeyValueList {
                        values: vec![opentelemetry_proto::tonic::common::v1::KeyValue {
                            key: in_str.clone(),
                            value: Some(int_val.clone()),
                        }],
                    },
                },
            ),
        };
        let resp = get_val(Some(kv_val));
        assert!(resp.as_object().unwrap().contains_key(&in_str));

        let in_byte =
            opentelemetry_proto::tonic::common::v1::any_value::Value::BytesValue(vec![8u8]);

        let byte_val = AnyValue {
            value: Some(in_byte),
        };
        let resp = get_val(Some(byte_val));
        assert!(resp.as_array().unwrap().len() > 0);
    }
}
